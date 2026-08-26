export interface WifiAssociation {
  interface: string;
  ssid: string;
  bssid?: string;
  signalDbm?: number;
  channel?: number;
  band?: string;
  security?: string;
  phyMode?: string;
}

export interface WifiEvent {
  timestamp: string;
  category: "associate" | "disassociate" | "roam" | "auth" | "other";
  ssid?: string;
  bssid?: string;
  message: string;
}
