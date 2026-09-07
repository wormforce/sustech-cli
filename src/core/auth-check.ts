import { type Credentials } from "./credentials.js";
import { CliError } from "./errors.js";
import { BookingSession } from "../services/booking-auth.js";
import {
  createBlackboardBrowserAdapter,
  type BlackboardBrowserOptions,
  type BlackboardBrowserRuntime,
} from "../services/blackboard-browser.js";
import { getBlackboardUser } from "../services/blackboard.js";
import { type ServiceAdapter } from "../services/base.js";
import { LibraryBookingSession } from "../services/library-booking-auth.js";
import { getLibraryBookingUser } from "../services/library.js";
import { PmsSession } from "../services/pms-auth.js";
import { type CasServiceConfig, CasSession } from "../sso/cas.js";
import { TisSession } from "../tis/auth.js";

export type AuthService = "tis" | "bb" | "ws" | "booking" | "lib-booking" | "pms";

export interface BlackboardBrowserAuthOptions extends BlackboardBrowserOptions {
  runtime?: BlackboardBrowserRuntime;
  fetchImpl?: typeof fetch;
}

export async function authenticateCredentials(
  credentials: Credentials,
  service: AuthService,
): Promise<{ authenticated: true; credentialSource: string; identity?: string }> {
  if (service === "tis") {
    await new TisSession(credentials).login();
    return { authenticated: true, credentialSource: credentials.source };
  }
  if (service === "bb") {
    const session = new CasSession(credentials, casServiceConfig("bb"));
    await session.login();
    const user = await getBlackboardUser(casSessionAdapter("bb", session));
    return {
      authenticated: true,
      credentialSource: credentials.source,
      ...((user.displayName || user.userName) ? { identity: user.displayName || user.userName } : {}),
    };
  }
  if (service === "ws") {
    await new CasSession(credentials, casServiceConfig("ws")).login();
    return { authenticated: true, credentialSource: credentials.source };
  }
  if (service === "booking") {
    const session = new BookingSession(credentials);
    await session.login();
    return {
      authenticated: true,
      credentialSource: credentials.source,
      ...(session.userProfile?.name ? { identity: session.userProfile.name } : {}),
    };
  }
  if (service === "lib-booking") {
    const session = new LibraryBookingSession(credentials);
    await session.login();
    const user = await getLibraryBookingUser(session);
    return {
      authenticated: true,
      credentialSource: credentials.source,
      ...((user.trueName || user.logonName) ? { identity: user.trueName || user.logonName } : {}),
    };
  }
  const session = new PmsSession({ username: credentials.sid, password: credentials.password });
  await session.login();
  const check = await session.check();
  if (!check.authenticated) {
    throw new CliError("PMS login completed but the session check failed.", "AUTHENTICATION_FAILED", 2, {
      service: "pms",
    });
  }
  return {
    authenticated: true,
    credentialSource: credentials.source,
    ...(check.displayName ? { identity: check.displayName } : {}),
  };
}

export async function authenticateBlackboardBrowserSession(
  options: BlackboardBrowserAuthOptions = {},
): Promise<{ authenticated: true; credentialSource: string; identity?: string }> {
  const adapter = await createBlackboardBrowserAdapter(
    options,
    options.runtime,
    options.fetchImpl,
  );
  const user = await getBlackboardUser(adapter);
  return {
    authenticated: true,
    credentialSource: "browser-session",
    ...((user.displayName || user.userName) ? { identity: user.displayName || user.userName } : {}),
  };
}

export function casServiceConfig(service: "bb" | "ws"): CasServiceConfig {
  if (service === "bb") {
    return {
      name: "Blackboard",
      baseUrl: "https://bb.sustech.edu.cn",
      serviceUrl: "https://bb.sustech.edu.cn/webapps/bb-sso-BBLEARN/index.jsp",
    };
  }
  return {
    name: "SUSTech Global",
    baseUrl: "https://ws.sustech.edu.cn",
    serviceUrl: "https://ws.sustech.edu.cn/SUSTechHome.aspx",
  };
}

function casSessionAdapter(name: "bb" | "ws", session: CasSession): ServiceAdapter {
  return {
    name,
    fetch(input: string, init?: RequestInit): Promise<Response> {
      return session.fetch(input, init);
    },
  };
}
