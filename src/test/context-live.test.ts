import assert from "node:assert/strict";
import test from "node:test";
import {
  aqiLevel,
  normaliseContextAirQuality,
  normaliseContextWeather,
  parseContextLibraryStatus,
} from "../context/live.js";

test("context weather parser extracts concise condition and rounded temperatures", () => {
  assert.deepEqual(
    normaliseContextWeather({
      msg: "南科大天气：气温26.8℃，体感29.1℃，近两个小时内无降雨。",
      update_time: "2026-08-28T12:00:00+08:00",
    }),
    {
      condition: "气温26.8℃，体感29.1℃，近两个小时内无降雨。",
      tempC: 27,
      feelsLikeC: 29,
    },
  );
  assert.equal(normaliseContextWeather({ msg: "" }), null);
});

test("context AQI parser preserves particles and maps standard levels", () => {
  assert.deepEqual(
    normaliseContextAirQuality({
      current: {
        us_aqi: 88,
        pm2_5: 18.4,
        pm10: 26.1,
        ozone: 92,
      },
    }),
    {
      aqi: 88,
      level: "Moderate",
      pm25: 18.4,
      pm10: 26.1,
      ozone: 92,
    },
  );
  assert.equal(normaliseContextAirQuality({ current: {} }), null);
  assert.equal(aqiLevel(35), "Good");
  assert.equal(aqiLevel(135), "Unhealthy for Sensitive Groups");
  assert.equal(aqiLevel(260), "Very Unhealthy");
});

test("context library parser extracts live room open status from the homepage", () => {
  const html = [
    "<li><span class=\"name\">一丹</span><span class=\"num2\">865</span></li>",
    "<!-- <li><span class=\"name\">涵泳</span><span class=\"num2\">132</span></li> -->",
    "<span class=\"infoh\">周一至周日：8:00 - 22:00</span>",
    "<li><span class=\"name\">一丹</span><span class=\"now\">开放中</span></li>",
    "<li><span class=\"name\">琳恩</span><span class=\"now\">闭馆</span></li>",
    "<li><span class=\"name\">涵泳</span><span class=\"now\">开放中</span></li>",
  ].join("");
  assert.equal(parseContextLibraryStatus(html), "一丹: 开放中, 琳恩: 闭馆, 涵泳: 开放中");
  assert.equal(parseContextLibraryStatus("<html></html>"), null);
});
