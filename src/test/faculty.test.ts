import assert from "node:assert/strict";
import test from "node:test";
import { DEPARTMENTS, FacultyClient, facultyToMarkdown, parseFacultyCards, parseFacultyProfile } from "../faculty/client.js";

const INDEX_HTML = `
<li><a href="/alexander/" target="_blank">
  <div class="teacher_iteam">
    <div class="teacher_top">
      <div class="teacher_tx" style="background:url(http://example.com/a.jpg)"></div>
    </div>
    <div class="teacher_cont">
      <h2>Alexander Kurganov</h2>
      <span></span>
      <h3></h3>
      <p>数学系</p>
    </div>
  </div>
</a></li>
<li><a href="/zhangsan/" target="_blank">
  <div class="teacher_iteam">
    <div class="teacher_top">
      <div class="teacher_tx" style="background:url(http://example.com/b.jpg)"></div>
    </div>
    <div class="teacher_cont">
      <h2>张三</h2>
      <span></span>
      <h3>教授</h3>
      <p>|工学院 物理系 课题组网站</p>
    </div>
  </div>
</a></li>
`;

const PROFILE_HTML = `
<html><body>
  <div class="teachers_info">
    <dl>
      <dt class="bgimgdt" style="background-image: url(http://example.com/p.jpg);">
        <img class="opavatarimg" src="http://example.com/p.jpg" />
      </dt>
    </dl>
  </div>
  <div class="teachers_desc">
    <h2 class="t_name">张三</h2>
    <em class="t_zw">教授</em>
    <span class="t_xy">物理系</span>
    <div class="t_descs"><p>张三是一个测试用户。</p></div>
  </div>
  <div class="js_background">
    <div class="jsjj_ct">
      <p><strong>教育经历：</strong></p>
      <p>2010-2014 清华大学 学士</p>
      <p><strong>工作经历：</strong></p>
      <p>2014-现在 清华大学 教授</p>
      <p><strong>目前研究兴趣：</strong></p>
      <p><strong>量子计算</strong></p>
      <p>量子算法的设计与实现</p>
    </div>
  </div>
  <div><p>联系地址</p><p>北京市海淀区</p></div>
  <div><p>办公电话</p><p>010-12345678</p></div>
  <div><p>电子邮箱</p><p>zhangsan@sustech.edu.cn</p></div>
</body></html>
`;

test("faculty exposes the department registry", () => {
  assert.ok(DEPARTMENTS.length >= 50);
  assert.ok(DEPARTMENTS.includes("材料科学与工程系"));
});

test("faculty index parser extracts lightweight cards", () => {
  const cards = parseFacultyCards(INDEX_HTML);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].slug, "alexander");
  assert.equal(cards[0].department, "数学系");
  assert.equal(cards[1].department, "物理系");
  assert.equal(cards[1].title, "教授");
});

test("faculty profile parser extracts structured sections and contact fields", () => {
  const profile = parseFacultyProfile(PROFILE_HTML, { slug: "zhangsan" });
  assert.equal(profile.name, "张三");
  assert.equal(profile.title, "教授");
  assert.equal(profile.email, "zhangsan@sustech.edu.cn");
  assert.equal(profile.phone, "010-12345678");
  assert.equal(profile.office, "北京市海淀区");
  assert.equal(profile.photoUrl, "http://example.com/p.jpg");
  assert.deepEqual(profile.education, ["2010-2014 清华大学 学士"]);
  assert.deepEqual(profile.workHistory, ["2014-现在 清华大学 教授"]);
  assert.deepEqual(profile.researchInterests, ["量子计算", "量子算法的设计与实现"]);
  assert.match(facultyToMarkdown(profile), /## Research Interests/);
});

test("faculty client can search within a department using HTML fixtures", async () => {
  await withFetch(async (url) => {
    if (url.includes("ajax=users")) {
      return textResponse(url.includes("page=1") ? INDEX_HTML : "0");
    }
    assert.ok(url.includes("tagid=zhangsan"));
    return textResponse(PROFILE_HTML);
  }, async () => {
    const results = await new FacultyClient().search("量子", { dept: "物理系", limit: 5 });
    assert.equal(results.length, 1);
    assert.equal(results[0].slug, "zhangsan");
    assert.ok((results[0].relevanceScore ?? 0) > 0);
    assert.ok(results[0].matchedFields.includes("researchInterests"));
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

function textResponse(value: string): Response {
  return new Response(value, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
