/**
 * @file modJarParser.ts
 * @description 純函式 jar metadata 解析器：輸入 jar 位元組，輸出 mod 顯示用 metadata。
 *   支援 Fabric / Quilt / NeoForge / Forge（新舊）四系格式 + icon 抽取。
 *   不碰 DB/S3，方便單元測試；對一切異常回 null（或跳過 icon），絕不 throw。
 * @dependencies adm-zip, @iarna/toml
 */
import AdmZip from "adm-zip";
import { parse as parseToml } from "@iarna/toml";

/** 解析出的 mod metadata；iconBytes 有值代表抽到合法 PNG icon */
export interface ParsedMod {
  mod_id: string | null;
  mod_name: string | null;
  mod_version: string | null;
  loader_hint: "fabric" | "quilt" | "neoforge" | "forge" | "legacy";
  iconBytes?: Buffer;
}

/** icon 大小上限（位元組）；多數 mod icon 128–512px PNG 遠低於此 */
const MAX_ICON_BYTES = 256 * 1024;
/** PNG 檔頭 magic bytes（收/棄依此、非路徑副檔名） */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * 正規化 metadata 欄位值：非字串、空字串、Gradle 佔位符（`${...}`）一律視為無值回 null。
 *
 * @param v - 原始欄位值
 */
function cleanValue(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.startsWith("${")) return null;
  return s;
}

/**
 * 依 jar 內路徑抽出 icon 位元組；僅接受 PNG（magic bytes）、上限 256 KB，否則回 undefined。
 *
 * @param zip - 已開啟的 jar
 * @param iconPath - metadata 指的 jar 內相對路徑（可能帶前導斜線）
 */
function extractIcon(zip: AdmZip, iconPath: unknown): Buffer | undefined {
  const p = cleanValue(iconPath);
  if (!p) return undefined;
  const entry = zip.getEntry(p.replace(/^\/+/, ""));
  if (!entry) return undefined;
  const data = entry.getData();
  if (data.length > MAX_ICON_BYTES) return undefined;
  if (data.length < 4 || !data.subarray(0, 4).equals(PNG_MAGIC)) return undefined;
  return data;
}

/** 讀取 jar 內某文字檔（不存在回 null） */
function readText(zip: AdmZip, path: string): string | null {
  const entry = zip.getEntry(path);
  return entry ? entry.getData().toString("utf-8") : null;
}

/**
 * fabric.mod.json（jar 根，JSON）：id / name（缺省=id）/ version / icon。
 * fabric 的 icon 欄位可為字串或 {size: path} 物件。
 */
function parseFabric(zip: AdmZip): ParsedMod | null {
  const raw = readText(zip, "fabric.mod.json");
  if (raw === null) return null;
  const data: any = JSON.parse(raw);
  const mod_id = cleanValue(data.id);
  const iconField =
    typeof data.icon === "string" ? data.icon : data.icon ? Object.values(data.icon)[0] : null;
  return {
    mod_id,
    mod_name: cleanValue(data.name) ?? mod_id,
    mod_version: cleanValue(data.version),
    loader_hint: "fabric",
    iconBytes: extractIcon(zip, iconField),
  };
}

/**
 * quilt.mod.json（jar 根，JSON）：quilt_loader.id / .metadata.name / .version / .metadata.icon。
 */
function parseQuilt(zip: AdmZip): ParsedMod | null {
  const raw = readText(zip, "quilt.mod.json");
  if (raw === null) return null;
  const ql: any = JSON.parse(raw).quilt_loader ?? {};
  const meta: any = ql.metadata ?? {};
  const iconField = typeof meta.icon === "string" ? meta.icon : meta.icon ? Object.values(meta.icon)[0] : null;
  return {
    mod_id: cleanValue(ql.id),
    mod_name: cleanValue(meta.name),
    mod_version: cleanValue(ql.version),
    loader_hint: "quilt",
    iconBytes: extractIcon(zip, iconField),
  };
}

/**
 * TOML 系（neoforge.mods.toml / mods.toml）：取 [[mods]] 第一項的
 * modId / displayName / version / logoFile（jar 根相對路徑）。
 *
 * @param zip - 已開啟的 jar
 * @param tomlPath - jar 內 toml 路徑
 * @param loader - 對應的 loader_hint
 */
function parseTomlMods(
  zip: AdmZip,
  tomlPath: string,
  loader: "neoforge" | "forge"
): ParsedMod | null {
  const raw = readText(zip, tomlPath);
  if (raw === null) return null;
  const data: any = parseToml(raw);
  const first: any = Array.isArray(data.mods) ? data.mods[0] : undefined;
  if (!first) return null;
  return {
    mod_id: cleanValue(first.modId),
    mod_name: cleanValue(first.displayName),
    mod_version: cleanValue(first.version),
    loader_hint: loader,
    iconBytes: extractIcon(zip, first.logoFile),
  };
}

/**
 * mcmod.info（jar 根，JSON）：相容陣列頂層與 {modList:[...]} 兩形狀，取第一項的
 * modid / name / version / logoFile。
 */
function parseLegacy(zip: AdmZip): ParsedMod | null {
  const raw = readText(zip, "mcmod.info");
  if (raw === null) return null;
  const data: any = JSON.parse(raw);
  const list: any[] = Array.isArray(data) ? data : Array.isArray(data.modList) ? data.modList : [];
  const first: any = list[0];
  if (!first) return null;
  return {
    mod_id: cleanValue(first.modid),
    mod_name: cleanValue(first.name),
    mod_version: cleanValue(first.version),
    loader_hint: "legacy",
    iconBytes: extractIcon(zip, first.logoFile),
  };
}

/** 偵測順序：命中即停（fabric > quilt > neoforge > forge > legacy） */
const DETECTORS: Array<(zip: AdmZip) => ParsedMod | null> = [
  parseFabric,
  parseQuilt,
  (zip) => parseTomlMods(zip, "META-INF/neoforge.mods.toml", "neoforge"),
  (zip) => parseTomlMods(zip, "META-INF/mods.toml", "forge"),
  parseLegacy,
];

/**
 * 解析 jar 位元組，回傳 mod metadata；完全無法解析（損壞 zip / 無任何已知 metadata 檔）回 null。
 *
 * 純函式、in-memory（Buffer 已在手，不落暫存檔）。單一 detector 內部異常
 * （如某 metadata 檔內容損壞）視為未命中，續試下一格式；全部落空才回 null。
 *
 * @param buffer - jar 檔位元組
 */
export function parseModJar(buffer: Buffer): ParsedMod | null {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return null;
  }
  for (const detect of DETECTORS) {
    try {
      const result = detect(zip);
      if (result) return result;
    } catch {
      // 該格式檔內容損壞 → 視為未命中，續試下一格式
    }
  }
  return null;
}
