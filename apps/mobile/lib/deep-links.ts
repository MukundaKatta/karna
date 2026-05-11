export type MobileTab = "chat" | "tasks" | "memory" | "skills" | "settings";
export type MobileTabRoute = `/(tabs)/${MobileTab}`;

export interface MobileDeepLinkAction {
  route?: MobileTabRoute;
  gatewayUrl?: string;
  token?: string;
  liveVoiceEnabled?: boolean;
  chatDraft?: string;
  newTaskTitle?: string;
  newTaskDescription?: string;
  memorySearchQuery?: string;
  authCode?: string;
}

const TAB_ROUTES: Record<MobileTab, MobileTabRoute> = {
  chat: "/(tabs)/chat",
  tasks: "/(tabs)/tasks",
  memory: "/(tabs)/memory",
  skills: "/(tabs)/skills",
  settings: "/(tabs)/settings",
};

const TAB_ALIASES: Record<string, MobileTab> = {
  chat: "chat",
  messages: "chat",
  task: "tasks",
  tasks: "tasks",
  reminders: "tasks",
  memory: "memory",
  memories: "memory",
  skills: "skills",
  settings: "settings",
};

export function getMobileTabRoute(tab: unknown): MobileTabRoute | undefined {
  if (typeof tab !== "string") return undefined;
  return TAB_ROUTES[TAB_ALIASES[tab.trim().toLowerCase()]];
}

export function parseMobileDeepLink(
  incomingUrl: string | null | undefined,
): MobileDeepLinkAction | undefined {
  if (!incomingUrl) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(incomingUrl);
  } catch {
    return undefined;
  }

  const params = parsed.searchParams;
  const firstPathSegment = parsed.pathname.split("/").filter(Boolean)[0];
  const secondPathSegment = parsed.pathname.split("/").filter(Boolean)[1];
  const host = parsed.hostname.toLowerCase();
  const route =
    getMobileTabRoute(params.get("tab")) ??
    getMobileTabRoute(firstPathSegment) ??
    getMobileTabRoute(host);
  const gatewayUrl =
    params.get("gatewayUrl") ?? params.get("gateway") ?? params.get("wsUrl");
  const token = params.get("token") ?? undefined;
  const liveVoice = params.get("liveVoice");
  const chatDraft = params.get("message") ?? undefined;
  const memorySearchQuery = params.get("search") ?? undefined;
  const authCode = params.get("code") ?? undefined;

  const action: MobileDeepLinkAction = {};
  if (route) action.route = route;
  const linkTarget = host === "app.karna.ai" ? firstPathSegment : host;
  const linkSubtarget = host === "app.karna.ai" ? secondPathSegment : firstPathSegment;

  if (linkTarget === "chat" && chatDraft) {
    action.route = TAB_ROUTES.chat;
    action.chatDraft = chatDraft;
  }
  if (linkTarget === "tasks" && linkSubtarget === "new") {
    action.route = TAB_ROUTES.tasks;
    action.newTaskTitle = params.get("title") ?? "";
    action.newTaskDescription = params.get("description") ?? undefined;
  }
  if (linkTarget === "memory" && memorySearchQuery) {
    action.route = TAB_ROUTES.memory;
    action.memorySearchQuery = memorySearchQuery;
  }
  if (linkTarget === "auth" && linkSubtarget === "callback" && authCode) {
    action.route = TAB_ROUTES.settings;
    action.authCode = authCode;
  }
  if (gatewayUrl) action.gatewayUrl = gatewayUrl;
  if (token !== undefined) action.token = token;
  if (liveVoice !== null) {
    action.liveVoiceEnabled = ["1", "true", "yes", "on"].includes(
      liveVoice.toLowerCase(),
    );
  }

  return Object.keys(action).length > 0 ? action : undefined;
}
