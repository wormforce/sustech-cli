import type { Credentials } from "../core/credentials.js";
import { CasSession } from "../sso/cas.js";

export class TisSession extends CasSession {
  public constructor(credentials: Credentials) {
    super(credentials, {
      name: "TIS",
      baseUrl: "https://tis.sustech.edu.cn",
      serviceUrl: "https://tis.sustech.edu.cn/cas",
      submitValue: null,
    });
  }
}
