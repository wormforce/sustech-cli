import assert from "node:assert/strict";
import test from "node:test";
import { TransitClient } from "../transit/client.js";

test("transit client normalizes public GeoJSON facilities", async () => {
  await withFetch(async (url) => {
    if (url.includes("sustech_bldg")) {
      return jsonResponse({
        features: [{
          properties: { name: "宿舍 Dorm Block 13" },
          geometry: { coordinates: [113.99, 22.6] },
        }],
      });
    }
    return jsonResponse({
      features: [{
        properties: { name: "一号门 Gate 1" },
        geometry: { coordinates: [114, 22.61] },
      }],
    });
  }, async () => {
    const facilities = await new TransitClient().facilities();
    assert.deepEqual(facilities, [
      { id: "building:宿舍13栋", name: "宿舍13栋", nameEn: "Dorm Block 13", kind: "building", lat: 22.6, lng: 113.99, routes: [] },
      { id: "gate:一号门", name: "一号门", nameEn: "Gate 1", kind: "gate", lat: 22.61, lng: 114, routes: [] },
    ]);
  });
});

test("transit schedule resolves a configured relative schedule source", async () => {
  await withFetch(async (url) => {
    if (url.endsWith("bus_config.json")) {
      return jsonResponse({
        workday: [{
          id: "line1",
          title: "1 路 / Line 1",
          routes: [{
            name: "1路 内环",
            description: "Clockwise",
            type: "loop",
            color: "#00ab5b",
            sources: [{ url: "/bus_times/one_down.json", type: "bus" }],
          }],
        }],
      });
    }
    assert.equal(url, "https://sustech.online/bus_times/one_down.json");
    return jsonResponse({ times: ["07:20", "07:30"], minuteOnRoad: 25 });
  }, async () => {
    const schedule = await new TransitClient().schedule("line1", 0, "workday");
    assert.equal(schedule.routeName, "1路 内环");
    assert.deepEqual(schedule.times, ["07:20", "07:30"]);
  });
});

test("transit schedule does not invent a duration when the feed omits it", async () => {
  await withFetch(async (url) => {
    if (url.endsWith("bus_config.json")) {
      return jsonResponse({
        workday: [{
          id: "ipark",
          title: "Innovation Park",
          routes: [{
            name: "去程",
            description: "Outbound",
            sources: [{ url: "/bus_times/ipark_out.json", type: "bus" }],
          }],
        }],
      });
    }
    return jsonResponse({ times: ["08:00"] });
  }, async () => {
    const schedule = await new TransitClient().schedule("ipark", 0, "workday");
    assert.equal(schedule.minuteOnRoad, undefined);
    assert.equal(Object.hasOwn(schedule, "minuteOnRoad"), false);
  });
});

async function withFetch(
  implementation: (url: string) => Promise<Response>,
  action: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => implementation(String(input))) as typeof fetch;
  try {
    await action();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
