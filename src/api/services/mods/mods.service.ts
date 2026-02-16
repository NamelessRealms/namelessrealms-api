import got from "got";
import { config } from "../../../config/config.service";

export default class ModsService {
  private readonly _curseForgeBaseUrl = "https://api.curseforge.com/v1";

  public async getMod(projectId: string, fileId: string): Promise<any> {
    // curseForgeResponse.body.forEach((item) => console.log(item.name));
    // console.log(curseForgeResponse.body.length);

    // const curseForgeResponse = await got.get<any>("https://api.curseforge.com/v1/mods/search?gameId=432&classId=6&sortField=2&sortOrder=desc&pageSize=20&index=2000", {
    //     headers: {
    //         "Accept":"application/json",
    //         "x-api-key": config.curseforgeKey
    //     },
    //     responseType: "json"
    // });

    // curseForgeResponse.body.data.forEach((item: any) => console.log(item.name));

    const curseForgeModResponse = await got.get<any>(
      this._curseForgeBaseUrl + `/mods/${projectId}/files/${fileId}`,
      {
        headers: {
          Accept: "application/json",
          "x-api-key": config.curseforgeKey,
        },
        responseType: "json",
      },
    );

    if (curseForgeModResponse.statusCode !== 200) {
      throw {
        error: "request_curseforge_error",
        error_description: "Request CurseForge Error.",
      };
    }

    return curseForgeModResponse.body;
  }

  public async getMods(modIds: Array<string>): Promise<any> {
    const curseForgeModsResponse = await got.post<any>(
      this._curseForgeBaseUrl + "/mods",
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-api-key": config.curseforgeKey,
        },
        responseType: "json",
        json: {
          modIds: modIds,
        },
      },
    );

    if (curseForgeModsResponse.statusCode !== 200) {
      throw {
        error: "request_curseforge_error",
        error_description: "Request CurseForge Error.",
      };
    }

    return curseForgeModsResponse.body;
  }

  public async getModFiles(modFileIds: Array<string>): Promise<any> {
    const curseForgeModFilesResponse = await got.post<any>(
      this._curseForgeBaseUrl + "/mods/files",
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-api-key": config.curseforgeKey,
        },
        responseType: "json",
        json: {
          fileIds: modFileIds,
        },
      },
    );

    if (curseForgeModFilesResponse.statusCode !== 200) {
      throw {
        error: "request_curseforge_error",
        error_description: "Request CurseForge Error.",
      };
    }

    return curseForgeModFilesResponse.body;
  }
}
