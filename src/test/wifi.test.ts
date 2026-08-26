import assert from "node:assert/strict";
import test from "node:test";
import { parseCurrentNetwork, parseCurrentNetworkJson, parseWifiEvents } from "../wifi/client.js";

test("Wi-Fi JSON parser uses locale-independent system_profiler keys", () => {
  const parsed = parseCurrentNetworkJson(JSON.stringify({
    SPAirPortDataType: [{
      spairport_airport_interfaces: [{
        _name: "en1",
        spairport_current_network_information: {
          _name: "SUSTC-Wifi",
          spairport_network_channel: "52 (5GHz, 80MHz)",
          spairport_network_phymode: "802.11ax",
          spairport_security_mode: "spairport_security_mode_wpa2_enterprise",
          spairport_signal_noise: "-52 dBm / -98 dBm",
          spairport_network_bssid: "aa:bb:cc:dd:ee:ff",
        },
      }],
    }],
  }));
  assert.deepEqual(parsed, {
    interface: "en1",
    ssid: "SUSTC-Wifi",
    phyMode: "802.11ax",
    channel: 52,
    band: "5GHz, 80MHz",
    security: "WPA2 Enterprise",
    signalDbm: -52,
    bssid: "AA:BB:CC:DD:EE:FF",
  });
});

test("Wi-Fi parser reads the current network block without invoking macOS tools", () => {
  const parsed = parseCurrentNetwork(`
      Current Network Information:
        SUSTC-Wifi:
          PHY Mode: 802.11ax
          Channel: 52 (5GHz, 80MHz)
          Security: WPA2 Enterprise
          Signal / Noise: -52 dBm / -98 dBm
  `, "en1");
  assert.deepEqual(parsed, {
    interface: "en1",
    ssid: "SUSTC-Wifi",
    phyMode: "802.11ax",
    channel: 52,
    band: "5GHz, 80MHz",
    security: "WPA2 Enterprise",
    signalDbm: -52,
  });
});

test("Wi-Fi event parser classifies roaming and keeps the BSSID", () => {
  const events = parseWifiEvents(
    "2026-08-09 03:14:25.123456+0800 wifid roam SUSTC-Wifi to aa:bb:cc:dd:ee:ff",
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]?.category, "roam");
  assert.equal(events[0]?.bssid, "AA:BB:CC:DD:EE:FF");
});
