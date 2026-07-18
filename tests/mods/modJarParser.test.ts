/**
 * @file modJarParser.test.ts
 * @description jar metadata 解析器單元測試：四系格式 + legacy、偵測優先序、佔位符、
 *   icon magic-bytes 收/棄兩向、損壞/無 metadata 回 null。fixture jar 以 adm-zip 現組，不 commit 二進位。
 */
import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { parseModJar } from "../../src/api/utils/modJarParser";

/** 合法 PNG（magic bytes + padding） */
const pngBytes = (size = 100): Buffer =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size)]);
/** 非 PNG（JPEG magic） */
const jpegBytes = (): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50)]);

/** 以 {路徑: 內容} 現組一個 jar Buffer */
function makeJar(entries: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content));
  }
  return zip.toBuffer();
}

describe("parseModJar", () => {
  it("fabric.mod.json 完整解析（含 icon 抽出）", () => {
    const jar = makeJar({
      "fabric.mod.json": JSON.stringify({
        id: "examplemod",
        name: "Example Mod",
        version: "1.2.3",
        icon: "assets/example/icon.png",
      }),
      "assets/example/icon.png": pngBytes(),
    });
    const r = parseModJar(jar);
    expect(r).toMatchObject({
      mod_id: "examplemod",
      mod_name: "Example Mod",
      mod_version: "1.2.3",
      loader_hint: "fabric",
    });
    expect(r?.iconBytes).toBeInstanceOf(Buffer);
  });

  it("fabric：name 缺省時回退為 id", () => {
    const jar = makeJar({ "fabric.mod.json": JSON.stringify({ id: "noname", version: "1.0.0" }) });
    expect(parseModJar(jar)?.mod_name).toBe("noname");
  });

  it("quilt.mod.json 解析", () => {
    const jar = makeJar({
      "quilt.mod.json": JSON.stringify({
        quilt_loader: { id: "quiltmod", version: "2.0.0", metadata: { name: "Quilt Mod" } },
      }),
    });
    expect(parseModJar(jar)).toMatchObject({
      mod_id: "quiltmod",
      mod_name: "Quilt Mod",
      mod_version: "2.0.0",
      loader_hint: "quilt",
    });
  });

  it("META-INF/neoforge.mods.toml 解析（[[mods]] 首項）", () => {
    const jar = makeJar({
      "META-INF/neoforge.mods.toml":
        '[[mods]]\nmodId="neomod"\ndisplayName="Neo Mod"\nversion="3.0.0"\n',
    });
    expect(parseModJar(jar)).toMatchObject({
      mod_id: "neomod",
      mod_name: "Neo Mod",
      mod_version: "3.0.0",
      loader_hint: "neoforge",
    });
  });

  it("META-INF/mods.toml 解析（forge）", () => {
    const jar = makeJar({
      "META-INF/mods.toml": '[[mods]]\nmodId="forgemod"\ndisplayName="Forge Mod"\nversion="4.0.0"\n',
    });
    expect(parseModJar(jar)).toMatchObject({ mod_id: "forgemod", loader_hint: "forge" });
  });

  it("mcmod.info 解析（legacy，陣列頂層）", () => {
    const jar = makeJar({
      "mcmod.info": JSON.stringify([{ modid: "legacymod", name: "Legacy Mod", version: "5.0.0" }]),
    });
    expect(parseModJar(jar)).toMatchObject({
      mod_id: "legacymod",
      mod_name: "Legacy Mod",
      loader_hint: "legacy",
    });
  });

  it("mcmod.info 相容 {modList:[...]} 形狀", () => {
    const jar = makeJar({
      "mcmod.info": JSON.stringify({ modList: [{ modid: "wrapped", name: "Wrapped" }] }),
    });
    expect(parseModJar(jar)?.mod_id).toBe("wrapped");
  });

  it("偵測優先序：同時含 fabric.mod.json 與 mods.toml → 取 fabric", () => {
    const jar = makeJar({
      "fabric.mod.json": JSON.stringify({ id: "fab", version: "1.0.0" }),
      "META-INF/mods.toml": '[[mods]]\nmodId="forge"\ndisplayName="F"\nversion="1.0.0"\n',
    });
    expect(parseModJar(jar)?.loader_hint).toBe("fabric");
  });

  it("${...} Gradle 佔位符 → mod_version 為 null", () => {
    const jar = makeJar({
      "fabric.mod.json": JSON.stringify({ id: "ph", version: "${file.jarVersion}" }),
    });
    expect(parseModJar(jar)?.mod_version).toBeNull();
  });

  it("icon 依 magic bytes 而非路徑副檔名：路徑 .jpg 但內容是 PNG → 收", () => {
    const jar = makeJar({
      "fabric.mod.json": JSON.stringify({ id: "m", version: "1", icon: "icon.jpg" }),
      "icon.jpg": pngBytes(),
    });
    expect(parseModJar(jar)?.iconBytes).toBeInstanceOf(Buffer);
  });

  it("icon 依 magic bytes：路徑 .png 但內容非 PNG → 跳過 icon、metadata 照存", () => {
    const jar = makeJar({
      "fabric.mod.json": JSON.stringify({ id: "m", version: "1", icon: "icon.png" }),
      "icon.png": jpegBytes(),
    });
    const r = parseModJar(jar);
    expect(r?.mod_id).toBe("m");
    expect(r?.iconBytes).toBeUndefined();
  });

  it("icon 超 256KB → 跳過 icon、metadata 照存", () => {
    const jar = makeJar({
      "fabric.mod.json": JSON.stringify({ id: "big", version: "1", icon: "big.png" }),
      "big.png": pngBytes(257 * 1024),
    });
    const r = parseModJar(jar);
    expect(r?.mod_id).toBe("big");
    expect(r?.iconBytes).toBeUndefined();
  });

  it("損壞 zip → 回 null", () => {
    expect(parseModJar(Buffer.from("this is not a zip file"))).toBeNull();
  });

  it("無任何已知 metadata 檔 → 回 null", () => {
    expect(parseModJar(makeJar({ "README.txt": "hello" }))).toBeNull();
  });
});

describe("parseModJar — deps 依賴抽取", () => {
  it("fabric：depends keys 抽取，recommends/suggests 不取；fabric-api 不被濾、系統 id 被濾", () => {
    const jar = makeJar({
      "fabric.mod.json": JSON.stringify({
        id: "m",
        version: "1",
        depends: { minecraft: ">=1.20", java: ">=17", fabricloader: "*", "fabric-api": "*", sodium: "*" },
        recommends: { cloth: "*" },
        suggests: { jei: "*" },
      }),
    });
    expect(parseModJar(jar)?.deps).toEqual(["fabric-api", "sodium"]);
  });

  it("quilt：depends 支援 string 與 {id, optional}；optional 排除；去重 + 小寫", () => {
    const jar = makeJar({
      "quilt.mod.json": JSON.stringify({
        quilt_loader: {
          id: "q",
          version: "1",
          metadata: { name: "Q" },
          depends: ["Sodium", { id: "sodium" }, { id: "clothconfig", optional: true }, { id: "quilt_base" }],
        },
      }),
    });
    expect(parseModJar(jar)?.deps).toEqual(["sodium"]);
  });

  it("neoforge：[[dependencies.<modid>]] type==\"required\" 取、optional 不取", () => {
    const jar = makeJar({
      "META-INF/neoforge.mods.toml":
        '[[mods]]\nmodId="neomod"\nversion="1"\n' +
        '[[dependencies.neomod]]\nmodId="sodium"\ntype="required"\n' +
        '[[dependencies.neomod]]\nmodId="cloth"\ntype="optional"\n' +
        '[[dependencies.neomod]]\nmodId="minecraft"\ntype="required"\n',
    });
    expect(parseModJar(jar)?.deps).toEqual(["sodium"]);
  });

  it("forge mods.toml：[[dependencies.<modid>]] mandatory==true 取、false 不取", () => {
    const jar = makeJar({
      "META-INF/mods.toml":
        '[[mods]]\nmodId="forgemod"\nversion="1"\n' +
        '[[dependencies.forgemod]]\nmodId="jei"\nmandatory=true\n' +
        '[[dependencies.forgemod]]\nmodId="optlib"\nmandatory=false\n',
    });
    expect(parseModJar(jar)?.deps).toEqual(["jei"]);
  });

  it("legacy：requiredMods 全為必要，@ 版本後綴切除、系統 id 被濾", () => {
    const jar = makeJar({
      "mcmod.info": JSON.stringify([
        { modid: "m", name: "M", requiredMods: ["JEI@[15.0,)", "forge@[47,)", "sodium"] },
      ]),
    });
    expect(parseModJar(jar)?.deps).toEqual(["jei", "sodium"]);
  });

  it("有解析、無依賴 → deps 為 []", () => {
    const jar = makeJar({ "fabric.mod.json": JSON.stringify({ id: "m", version: "1" }) });
    expect(parseModJar(jar)?.deps).toEqual([]);
  });
});