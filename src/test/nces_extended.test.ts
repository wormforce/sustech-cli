import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  browseNces,
  getNcesCourseFilterOptions,
  getNcesCourseByCode,
  getNcesGlobalStats,
  getNcesRankings,
  getNcesCourseStats,
  getNcesTeacherDetail,
  listNcesCourseReviews,
  searchNces,
} from "../services/nces.js";
import type { ServiceAdapter } from "../services/base.js";
import { formatNcesCourseByCode, formatNcesDetail, formatNcesSearch, formatNcesTeacher } from "../services/text.js";

test("browseNces maps CLI sort modes onto upstream sort_by", async () => {
  const seen: string[] = [];
  const adapter = routeAdapter((url) => {
    seen.push(url);
    return jsonResponse({ items: [], total: 0, pages: 1 });
  });

  const cases = [
    { sort: "rating", sortBy: "rate" },
    { sort: "reviews", sortBy: "review_count" },
    { sort: "name", sortBy: "name" },
  ] as const;

  for (const entry of cases) {
    const result = await browseNces({ page: 2, perPage: 7, sort: entry.sort, adapter });
    assert.equal(result.page, 2);
    assert.equal(result.perPage, 7);
  }

  assert.equal(seen.length, cases.length);
  for (const [index, entry] of cases.entries()) {
    const url = new URL(seen[index]!);
    assert.equal(url.origin, "https://ncesnext.com");
    assert.equal(url.pathname, "/api/v1/course");
    assert.equal(url.searchParams.get("page"), "2");
    assert.equal(url.searchParams.get("per_page"), "7");
    assert.equal(url.searchParams.get("sort_by"), entry.sortBy);
  }
});

test("browseNces forwards the live offering_unit filter", async () => {
  const adapter = routeAdapter((url) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/api/v1/course");
    assert.equal(parsed.searchParams.get("offering_unit"), "计算机科学与工程系");
    return jsonResponse({
      items: [{
        id: 7103,
        name: "  程序设计基础 ",
        course_code: "CS109",
        teacher_names: " 王老师 ",
        term_ids: ["20222"],
        rate_average: 9.4,
        review_count: 27,
        difficulty_score: 74,
        homework_score: 69,
        grading_score: 72,
        gain_score: 94,
      }],
      total: 386,
      pages: 20,
    });
  });

  const result = await browseNces({
    page: 1,
    perPage: 20,
    sort: "rating",
    offeringUnit: "  计算机科学与工程系 ",
    adapter,
  });
  assert.equal(result.total, 386);
  assert.equal(result.offeringUnit, "计算机科学与工程系");
  assert.equal(result.items[0]?.name, "程序设计基础");
  assert.equal(result.items[0]?.teacher, "王老师");
});

test("getNcesCourseFilterOptions reads live offering units", async () => {
  const adapter = routeAdapter((url) => {
    assert.equal(url, "https://ncesnext.com/api/v1/course/filter-options");
    return jsonResponse({
      offering_units: ["计算机科学与工程系", "数学系", "  语言中心  "],
    });
  });

  const result = await getNcesCourseFilterOptions({ adapter });
  assert.deepEqual(result, {
    offeringUnits: ["计算机科学与工程系", "数学系", "语言中心"],
  });
});

test("getNcesGlobalStats normalises counts and distributions", async () => {
  const adapter = routeAdapter((url) => {
    assert.equal(url, "https://ncesnext.com/api/v1/stats");
    return jsonResponse({
      user_count: 10,
      course_count: 20,
      review_count: 30,
      teacher_count: 40,
      registered_teacher_count: 5,
      running_days: 1000,
      course_avg_rate: 8.12,
      course_avg_rate_count: 4.09,
      review_rate_distribution: [{ label: "10", value: 8 }],
      course_rate_distribution: [{ label: "9-10", value: 6 }],
      course_review_count_distribution: [{ label: "1", value: 4, cumulative: 4 }],
      user_review_count_distribution: [{ label: "2", value: 3, cumulative: 7 }],
      review_monthly_distribution: [{ label: "2026-09", value: 2, cumulative: 30 }],
      user_monthly_distribution: [{ label: "2026-09", value: 1, cumulative: 10 }],
    });
  });

  const stats = await getNcesGlobalStats({ adapter });
  assert.deepEqual(stats, {
    userCount: 10,
    courseCount: 20,
    reviewCount: 30,
    teacherCount: 40,
    registeredTeacherCount: 5,
    runningDays: 1000,
    courseAverageRating: 8.12,
    averageReviewsPerCourse: 4.09,
    reviewRateDistribution: [{ label: "10", value: 8 }],
    courseRateDistribution: [{ label: "9-10", value: 6 }],
    courseReviewCountDistribution: [{ label: "1", value: 4, cumulative: 4 }],
    userReviewCountDistribution: [{ label: "2", value: 3, cumulative: 7 }],
    reviewMonthlyDistribution: [{ label: "2026-09", value: 2, cumulative: 30 }],
    userMonthlyDistribution: [{ label: "2026-09", value: 1, cumulative: 10 }],
  });
});

test("getNcesRankings normalises teacher, course, review, and user ranking lists", async () => {
  const adapter = routeAdapter((url) => {
    assert.equal(url, "https://ncesnext.com/api/v1/stats/rankings");
    return jsonResponse({
      stats: {
        avg_rate: 8.1143,
        avg_rate_count: 4.088,
        avg_review_upvotes: 0.848,
        avg_review_length: 803.2648,
      },
      top_teachers: [
        { id: 11, name: "王老师", dept: "计算机科学与工程系", course_count: 7, review_count: 27, normalized_rate: 9.41 },
      ],
      top_rated_courses: [
        {
          id: 7103,
          name: "程序设计基础",
          course_code: "CS109",
          teacher_names: "王老师",
          term_ids: ["20222"],
          rate_average: 9.4,
          review_count: 27,
          difficulty_score: 74,
          homework_score: 69,
          grading_score: 72,
          gain_score: 94,
          normalized_rate: 9.36,
        },
      ],
      popular_courses: [
        {
          id: 7104,
          name: "数据结构",
          course_code: "CS203",
          teacher_names: "李老师",
          term_ids: ["20231"],
          rate_average: 9.1,
          review_count: 54,
          difficulty_score: 62,
          homework_score: 59,
          grading_score: 65,
          gain_score: 90,
          normalized_rate: 9.1,
        },
      ],
      top_reviews: [
        { course_id: 7103, course_name: "程序设计基础", review_id: 501, author_name: "匿名用户", is_anonymous: true, upvote_count: 12, content_length: 1600 },
      ],
      long_reviews: [
        { course_id: 7104, course_name: "数据结构", review_id: 601, author: { username: "Reviewer" }, author_name: "Reviewer", is_anonymous: false, upvote_count: 9, content_length: 5000 },
      ],
      top_users: [
        { user: { id: 99, username: "Boltzwell", avatar: "/static/image/user.png", identity: "Student" }, reviews_count: 64, review_upvotes_count: 117, review_length: 121001, score: 121.72 },
      ],
    });
  });

  const rankings = await getNcesRankings({ adapter });
  assert.equal(rankings.stats.averageRating, 8.1143);
  assert.equal(rankings.stats.averageReviewCount, 4.088);
  assert.equal(rankings.topTeachers[0]?.department, "计算机科学与工程系");
  assert.equal(rankings.topTeachers[0]?.directUrl, "https://ncesnext.com/teacher/11");
  assert.equal(rankings.topRatedCourses[0]?.normalizedRating, 9.36);
  assert.equal(rankings.topRatedCourses[0]?.semester, "2022春");
  assert.equal(rankings.popularCourses[0]?.reviewCount, 54);
  assert.equal(rankings.topReviews[0]?.courseUrl, "https://ncesnext.com/course/7103/");
  assert.equal(rankings.longReviews[0]?.author, "Reviewer");
  assert.equal(rankings.topUsers[0]?.avatar, "https://ncesnext.com/static/image/user.png");
  assert.equal(rankings.topUsers[0]?.reviewUpvotes, 117);
});

test("searchNces forwards pagination and type while retaining course, teacher, and review totals", async () => {
  const adapter = routeAdapter((url) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/api/v1/search");
    assert.equal(parsed.searchParams.get("q"), "操作系统");
    assert.equal(parsed.searchParams.get("page"), "2");
    assert.equal(parsed.searchParams.get("per_page"), "5");
    assert.equal(parsed.searchParams.get("type"), "all");
    return jsonResponse({
      courses: { items: [], total: 12, pages: 3 },
      teachers: { items: [{ id: 201, name: "张老师" }], total: 1 },
      reviews: { items: [{ id: 1, author_name: "匿名用户", term: "20252", rate: 8, content: "有收获" }], total: 7 },
    });
  });

  const result = await searchNces("操作系统", { page: 2, perPage: 5, type: "all", adapter });
  assert.equal(result.total, 12);
  assert.equal(result.pages, 3);
  assert.equal(result.aggregateTotal, 20);
  assert.equal(result.aggregateShown, 2);
  assert.equal(result.courseTotal, 12);
  assert.equal(result.coursePages, 3);
  assert.equal(result.selectedBucket, "course");
  assert.equal(result.selectedItems.length, 0);
  assert.equal(result.teacherTotal, 1);
  assert.equal(result.reviewTotal, 7);
  assert.deepEqual(result.aggregateItems.map((entry) => entry.kind), ["teacher", "review"]);
  assert.equal(result.teachers[0]?.name, "张老师");
  assert.equal(result.sampleReviews[0]?.author, "匿名用户");
});

test("searchNces keeps aggregate totals truthful when type=all has no course matches", async () => {
  const adapter = routeAdapter((url) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("type"), "all");
    return jsonResponse({
      courses: { items: [], total: 0, pages: 0 },
      teachers: { items: [{ id: 1, name: "融亦鸣" }], total: 1, pages: 1 },
      reviews: { items: [{ id: 9, author_name: "匿名用户", term: "20252", rate: 8, content: "有收获" }], total: 15, pages: 15 },
    });
  });

  const result = await searchNces("rongym", { page: 1, perPage: 1, type: "all", adapter });
  assert.equal(result.total, 0);
  assert.equal(result.pages, 0);
  assert.equal(result.aggregateTotal, 16);
  assert.equal(result.aggregateShown, 2);
  assert.equal(result.courseTotal, 0);
  assert.equal(result.teacherTotal, 1);
  assert.equal(result.reviewTotal, 15);
  assert.equal(result.selectedBucket, "course");
  assert.equal(result.selectedItems.length, 0);
  assert.deepEqual(result.aggregateItems.map((entry) => entry.kind), ["teacher", "review"]);
  assert.equal(result.teachers[0]?.name, "融亦鸣");
  assert.equal(result.sampleReviews[0]?.author, "匿名用户");
});

test("formatNcesSearch surfaces bucket totals for mixed all-bucket output", () => {
  const text = formatNcesSearch(
    "rongym",
    [],
    [{ teacherId: 1, name: "融亦鸣", email: "rongym@sustech.edu.cn", title: "", image: "", directUrl: "https://ncesnext.com/teacher/1" }],
    [],
    { type: "all", courseTotal: 0, teacherTotal: 1, reviewTotal: 0, page: 1, perPage: 1 },
  );
  assert.match(text, /NCES search · rongym/u);
  assert.match(text, /Bucket totals · courses 0 · teachers 1 · reviews 0 · page 1 · page size 1/u);
  assert.match(text, /NCES teachers · 1/u);
});

test("searchNces total and pages follow a teacher-only result bucket", async () => {
  const adapter = routeAdapter((url) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("type"), "teacher");
    return jsonResponse({
      courses: null,
      teachers: { items: [{ id: 184, name: "王老师" }], total: 117, pages: 24 },
      reviews: null,
    });
  });
  const result = await searchNces("王老师", { type: "teacher", page: 1, perPage: 5, adapter });
  assert.equal(result.total, 117);
  assert.equal(result.pages, 24);
  assert.equal(result.courseTotal, 0);
  assert.equal(result.selectedBucket, "teacher");
  assert.equal(result.teacherTotal, 117);
  assert.equal(result.teacherPages, 24);
  assert.deepEqual(result.items, result.teachers);
  assert.deepEqual(result.selectedItems, result.teachers);
  assert.deepEqual(result.aggregateItems.map((entry) => entry.kind), ["teacher"]);
  assert.equal(result.teachers[0]?.name, "王老师");
});

test("searchNces items follow a review-only result bucket", async () => {
  const adapter = routeAdapter((url) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("type"), "review");
    return jsonResponse({
      courses: { items: [{ id: 7103, name: "程序设计基础", course_code: "CS109", teacher_names: "王老师", term_ids: ["20222"], rate_average: 9.4, review_count: 27, difficulty_score: 74, homework_score: 69, grading_score: 72, gain_score: 94 }], total: 1, pages: 1 },
      teachers: { items: [], total: 0, pages: 0 },
      reviews: { items: [{ id: 9, author_name: "匿名用户", term: "20252", rate: 8, upvote_count: 4, content: "有收获" }], total: 31, pages: 7 },
    });
  });

  const result = await searchNces("程序设计", { type: "review", page: 1, perPage: 5, adapter });
  assert.equal(result.total, 31);
  assert.equal(result.pages, 7);
  assert.equal(result.selectedBucket, "review");
  assert.equal(result.items[0]?.content, "有收获");
  assert.deepEqual(result.items, result.selectedItems);
  assert.deepEqual(result.aggregateItems.map((entry) => entry.kind), ["course", "review"]);
  assert.equal(result.courseItems[0]?.code, "CS109");
});

test("listNcesCourseReviews forwards filters and normalises page metadata", async () => {
  const adapter = routeAdapter((url) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/api/v1/course/244/reviews");
    assert.equal(parsed.searchParams.get("page"), "2");
    assert.equal(parsed.searchParams.get("per_page"), "3");
    assert.equal(parsed.searchParams.get("sort_by"), "score_desc");
    assert.equal(parsed.searchParams.get("term"), "20252");
    assert.equal(parsed.searchParams.get("rating"), "9");
    return jsonResponse({
      items: [{ id: 9, author: { username: "Reviewer" }, term: "20252", rate: 9, upvote_count: 4, content: "<p>清晰</p>" }],
      total: 10,
      page: 2,
      per_page: 3,
      pages: 4,
    });
  });

  const result = await listNcesCourseReviews(244, {
    page: 2,
    perPage: 3,
    sort: "rating-high",
    term: "20252",
    rating: 9,
    adapter,
  });
  assert.equal(result.items[0]?.author, "Reviewer");
  assert.equal(result.items[0]?.content, "清晰");
  assert.deepEqual({ total: result.total, page: result.page, perPage: result.perPage, pages: result.pages }, {
    total: 10,
    page: 2,
    perPage: 3,
    pages: 4,
  });
});

test("getNcesCourseByCode resolves course_id first, then fetches rich detail and reviews", async () => {
  const seen: string[] = [];
  const adapter = routeAdapter((url) => {
    seen.push(url);
    if (url === "https://ncesnext.com/api/v1/course/by-code/CS109?term=20222") {
      return jsonResponse({ course_id: 7103 });
    }
    if (url === "https://ncesnext.com/api/v1/course/7103") {
      return jsonResponse({
        id: 7103,
        name: "程序设计基础",
        course_code: "cs109",
        courseries: "CS109",
        course_material_code: "MAT-CS109",
        dept: "计算机科学与工程系",
        introduction: "<p>课程介绍</p>",
        homepage: "https://example.edu/cs109",
        admin_announcement: "<div>带实验</div>",
        access_count: 1234,
        credit: 3,
        hours: 48,
        hours_per_week: 4,
        description: "<p>中文描述</p>",
        description_eng: "<p>English description</p>",
        teaching_material: "<p>教材 A</p>",
        reference_material: "<p>参考资料 B</p>",
        student_requirements: "<p>需要编程基础</p>",
        campus: "SUSTech",
        course_major: "计算机类",
        course_type: "必修",
        grading_type: "百分制",
        review_term_list: ["20222", "20231"],
        teachers: [
          {
            id: 11,
            name: "王老师",
            email: "teacher@sustech.edu.cn",
            title: "<i>副教授</i>",
            image: "https://img.example/teacher.png",
          },
        ],
        terms: [
          {
            id: 1002,
            term: "20261",
            courseries: "CS109",
            kcid: "KCID-109",
            course_major: "计算机类",
            course_type: "必修",
            course_level: "本科",
            join_type: "正常选课",
            teaching_type: "课堂教学",
            grading_type: "百分制",
            credit: 3,
            hours: 48,
            hours_per_week: 4,
            campus: "SUSTech",
            start_week: 1,
            end_week: 16,
          },
          {
            id: 1001,
            term: "20222",
            courseries: "CS109",
            kcid: "KCID-109",
            course_major: "计算机类",
            course_type: "必修",
            course_level: "本科",
            join_type: "正常选课",
            teaching_type: "课堂教学",
            grading_type: "百分制",
            credit: 3,
            hours: 48,
            hours_per_week: 4,
            campus: "SUSTech",
            start_week: 1,
            end_week: 16,
          },
        ],
        related_courses: [
          {
            id: 7104,
            name: "数据结构",
            course_code: "CS203",
            teacher_names: "李老师",
            term_ids: ["20231"],
            rate_average: 9.1,
            review_count: 7,
            difficulty_score: 62,
            homework_score: 59,
            grading_score: 65,
            gain_score: 90,
          },
        ],
        same_teacher_courses: [
          {
            teacher: {
              id: 11,
              name: "王老师",
              email: "teacher@sustech.edu.cn",
              title: "副教授",
              image: "https://img.example/teacher.png",
            },
            courses: [
              {
                id: 8101,
                name: "编译原理",
                course_code: "CS308",
                teacher_names: "王老师",
                term_ids: ["20231"],
                rate_average: 8.8,
                review_count: 10,
                difficulty_score: 80,
                homework_score: 70,
                grading_score: 60,
                gain_score: 88,
              },
            ],
          },
        ],
        ai_summary: {
          overview: "<p>Rigorous and rewarding.</p>",
          strengths: ["<b>讲得清楚</b>", "练习充足"],
          caveats: ["节奏快"],
          assessment: ["适合愿意写代码的学生"],
          source_review_count: 27,
          generated_at: "2026-09-01T00:00:00Z",
        },
        rate: {
          average_rate: 9.4,
          review_count: 27,
          difficulty_score: 74,
          homework_score: 69,
          grading_score: 72,
          gain_score: 94,
        },
      });
    }
    if (url === "https://ncesnext.com/api/v1/course/7103/reviews?term=20222") {
      return jsonResponse({
        total: 3,
        page: 1,
        per_page: 2,
        pages: 2,
        items: [
          {
            id: 501,
            author: "Alice",
            term: "20222",
            rate: 9,
            upvote_count: 5,
            content: "<p>收获很大</p>",
          },
          {
            id: 502,
            author: "Bob",
            term: "20222",
            rate: 8,
            upvote_count: 2,
            content: "<p>作业不少</p>",
          },
        ],
      });
    }
    if (url === "https://ncesnext.com/api/v1/course/7103/reviews?page=2&per_page=2&term=20222") {
      return jsonResponse({
        total: 3,
        page: 2,
        per_page: 2,
        pages: 2,
        items: [
          {
            id: 502,
            author: "Bob",
            term: "20222",
            rate: 8,
            upvote_count: 2,
            content: "<p>作业不少</p>",
          },
          {
            id: 503,
            author: "Carol",
            term: "20222",
            rate: 10,
            upvote_count: 8,
            content: "<p>值得一上</p>",
          },
        ],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const course = await getNcesCourseByCode(" cs109 ", { term: "20222", adapter });

  assert.deepEqual(seen, [
    "https://ncesnext.com/api/v1/course/by-code/CS109?term=20222",
    "https://ncesnext.com/api/v1/course/7103",
    "https://ncesnext.com/api/v1/course/7103/reviews?term=20222",
  ]);
  assert.equal(course?.ncesId, 7103);
  assert.equal(course?.code, "CS109");
  assert.equal(course?.teacher, "王老师");
  assert.equal(course?.department, "计算机科学与工程系");
  assert.equal(course?.semester, "2022春");
  assert.deepEqual(course?.semesters, ["2022春", "2026秋"]);
  assert.equal(course?.courseMaterialCode, "MAT-CS109");
  assert.equal(course?.descriptionEng, "English description");
  assert.deepEqual(course?.reviewTerms, ["20222", "20231"]);
  assert.equal(course?.teachers[0]?.directUrl, "https://ncesnext.com/teacher/11");
  assert.equal(course?.terms[0]?.term, "2022春");
  assert.equal(course?.relatedCourses[0]?.code, "CS203");
  assert.equal(course?.sameTeacherCourses[0]?.courses[0]?.code, "CS308");
  assert.equal(course?.aiSummary?.overview, "Rigorous and rewarding.");
  assert.deepEqual(course?.aiSummary?.strengths, ["讲得清楚", "练习充足"]);
  assert.deepEqual(course?.aiSummary?.caveats, ["节奏快"]);
  assert.deepEqual(course?.aiSummary?.assessment, ["适合愿意写代码的学生"]);
  assert.equal(course?.aiSummary?.sourceReviewCount, 27);
  assert.equal(course?.aiSummary?.authority, "community");
  assert.equal(course?.aiSummary?.generatedBy, "NCES");
  assert.match(course?.aiSummary?.advisory ?? "", /AI-generated/u);
  assert.equal(course?.reviews[0]?.author, "Alice");
  assert.equal(course?.reviews[0]?.term, "2022春");
  assert.equal(course?.reviews[0]?.content, "收获很大");
  assert.equal(course?.reviews[1]?.author, "Bob");
  assert.equal(course?.reviews.length, 2);
  assert.equal(course?.reviewResultsTotal, 3);
  assert.equal(course?.reviewResultsPages, 2);
  assert.equal(course?.reviewResultsPerPage, 2);
  assert.equal(course?.reviewFilterTerm, "20222");
  assert.match(formatNcesCourseByCode("CS109", "20222", course), /Reviews loaded · 2\/3 .* course total 27/u);
});

test("getNcesCourseByCode loads every review page only when allReviews is enabled", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const seen: string[] = [];
  const adapter = routeAdapter(async (url) => {
    seen.push(url);
    if (url === "https://ncesnext.com/api/v1/course/by-code/CS208?term=20252") {
      return jsonResponse({ course_id: 8208 });
    }
    if (url === "https://ncesnext.com/api/v1/course/8208") {
      return jsonResponse({
        id: 8208,
        name: "算法设计",
        course_code: "CS208",
        courseries: "CS208",
        review_term_list: ["20252"],
        teachers: [],
        terms: [{ id: 1, term: "20252", courseries: "CS208" }],
        related_courses: [],
        same_teacher_courses: [],
        rate: {
          average_rate: 9.1,
          review_count: 16,
          difficulty_score: 70,
          homework_score: 68,
          grading_score: 72,
          gain_score: 92,
        },
      });
    }
    const parsed = new URL(url);
    if (parsed.pathname === "/api/v1/course/8208/reviews") {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await delay(5);
        const page = Number(parsed.searchParams.get("page") ?? "1");
        if (page === 1) {
          return jsonResponse({
            total: 16,
            page: 1,
            per_page: 2,
            pages: 8,
            items: [
              { id: 1, author: "A", term: "20252", rate: 9, content: "<p>1</p>" },
              { id: 2, author: "B", term: "20252", rate: 9, content: "<p>2</p>" },
            ],
          });
        }
        const firstId = (page - 1) * 2 + 1;
        return jsonResponse({
          total: 16,
          page,
          per_page: 2,
          pages: 8,
          items: [
            { id: firstId, author: `R${firstId}`, term: "20252", rate: 9, content: `<p>${firstId}</p>` },
            { id: firstId + 1, author: `R${firstId + 1}`, term: "20252", rate: 9, content: `<p>${firstId + 1}</p>` },
          ],
        });
      } finally {
        inFlight -= 1;
      }
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const course = await getNcesCourseByCode("CS208", { term: "20252", allReviews: true, adapter });

  assert.equal(course?.reviews.length, 16);
  assert.equal(course?.reviewResultsPages, 8);
  assert.ok(maxInFlight <= 5, `expected review-page fan-out <= 5, got ${maxInFlight}`);
  assert.deepEqual(
    seen.filter((url) => url.includes("/course/8208/reviews")),
    [
      "https://ncesnext.com/api/v1/course/8208/reviews?term=20252",
      "https://ncesnext.com/api/v1/course/8208/reviews?page=2&per_page=2&term=20252",
      "https://ncesnext.com/api/v1/course/8208/reviews?page=3&per_page=2&term=20252",
      "https://ncesnext.com/api/v1/course/8208/reviews?page=4&per_page=2&term=20252",
      "https://ncesnext.com/api/v1/course/8208/reviews?page=5&per_page=2&term=20252",
      "https://ncesnext.com/api/v1/course/8208/reviews?page=6&per_page=2&term=20252",
      "https://ncesnext.com/api/v1/course/8208/reviews?page=7&per_page=2&term=20252",
      "https://ncesnext.com/api/v1/course/8208/reviews?page=8&per_page=2&term=20252",
    ],
  );
});

test("NCES detail text distinguishes review-endpoint totals from the course headline review count", () => {
  const text = formatNcesDetail({
    ncesId: 244,
    code: "CS302",
    name: "计算机操作系统",
    teacher: "王老师",
    semester: "2025秋",
    semesters: ["2025秋"],
    rating: 9.2,
    reviewCount: 20,
    difficulty: { label: "Hard", pct: 80 },
    workload: { label: "Heavy", pct: 75 },
    grading: { label: "Fair", pct: 68 },
    takeaways: { label: "High", pct: 95 },
    directUrl: "https://ncesnext.com/course/244/",
    department: "计算机科学与工程系",
    courseries: "CS302",
    courseMaterialCode: "",
    introduction: "",
    homepage: "",
    adminAnnouncement: "",
    accessCount: 0,
    description: "",
    descriptionEng: "",
    teachingMaterial: "",
    referenceMaterial: "",
    studentRequirements: "",
    campus: "SUSTech",
    courseMajor: "计算机类",
    courseType: "必修",
    gradingType: "百分制",
    reviewTerms: ["20252"],
    reviewResultsTotal: 19,
    reviewResultsPages: 1,
    reviewResultsPerPage: 50,
    teachers: [],
    terms: [],
    relatedCourses: [],
    sameTeacherCourses: [],
    reviews: [],
  });
  assert.match(text, /Reviews loaded · 0\/19 across 1 page\(s\) from NCES · course total 20; use `nces reviews 244` for paginated inspection or rerun with `--all-reviews` to load every current page\./u);
});

test("getNcesCourseStats normalises distributions and term averages", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/course/7103/stats") {
      return jsonResponse({
        review_count: 5,
        rating_distribution: { "10": 3, "9": 2 },
        term_distribution: { "20222": 4, "20231": 1 },
        term_stats: [
          { term: "20222", review_count: 4, rate_average: 8.8 },
          { term: "20231", review_count: 1, rate_average: null },
        ],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const stats = await getNcesCourseStats(7103, { adapter });
  assert.deepEqual(stats, {
    reviewCount: 5,
    ratingDistribution: { "9": 2, "10": 3 },
    termDistribution: { "20222": 4, "20231": 1 },
    termStats: [
      { term: "2022春", reviewCount: 4, ratingAverage: 8.8 },
      { term: "2023秋", reviewCount: 1 },
    ],
  });
});

test("getNcesTeacherDetail normalises teacher profile and course list", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/teacher/11") {
      return jsonResponse({
        id: 11,
        name: "<p>王老师</p>",
        email: "teacher@sustech.edu.cn",
        title: "<span>副教授</span>",
        image: "https://img.example/teacher.png",
        access_count: 345,
        review_count: 27,
        average_rate: 9.4,
        normalized_rate: 96,
        gender: "F",
        description: "<p>研究编程语言。</p>",
        homepage: "https://example.edu/~teacher",
        research_interest: "<p>编译器，程序分析</p>",
        office_phone: "0755-12345678",
        courses: [
          {
            id: 7103,
            name: "程序设计基础",
            course_code: "CS109",
            teacher_names: "王老师",
            term_ids: ["20222"],
            rate_average: 9.4,
            review_count: 27,
            difficulty_score: 74,
            homework_score: 69,
            grading_score: 72,
            gain_score: 94,
          },
        ],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const teacher = await getNcesTeacherDetail(11, { adapter });
  assert.equal(teacher?.teacherId, 11);
  assert.equal(teacher?.name, "王老师");
  assert.equal(teacher?.title, "副教授");
  assert.equal(teacher?.directUrl, "https://ncesnext.com/teacher/11");
  assert.equal(teacher?.averageRate, 9.4);
  assert.equal(teacher?.normalizedRate, 96);
  assert.equal(teacher?.description, "研究编程语言。");
  assert.equal(teacher?.researchInterest, "编译器，程序分析");
  assert.equal(teacher?.courses.length, 1);
  assert.equal(teacher?.courses[0]?.code, "CS109");
  assert.equal(teacher?.courses[0]?.semester, "2022春");
});

test("NCES teacher detail preserves missing public rating metrics instead of zeroes", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/teacher/356") {
      return jsonResponse({
        id: 356,
        name: "刘珂廷",
        email: "liukt@sustech.edu.cn",
        review_count: 23,
        average_rate: null,
        normalized_rate: null,
        courses: [],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const teacher = await getNcesTeacherDetail(356, { adapter });
  assert.equal(teacher?.averageRate, null);
  assert.equal(teacher?.normalizedRate, null);
  assert.match(formatNcesTeacher(teacher ?? null), /Community rating unavailable · 23 review\(s\)/u);
  assert.doesNotMatch(formatNcesTeacher(teacher ?? null), /Community rating 0 · 23 review\(s\)/u);
});

test("NCES preserves missing course ratings and score dimensions instead of synthesizing zeroes", async () => {
  const adapter = routeAdapter((url) => {
    if (url === "https://ncesnext.com/api/v1/course/by-code/CS302?term=20252") {
      return jsonResponse({ course_id: 243 });
    }
    if (url === "https://ncesnext.com/api/v1/course/243") {
      return jsonResponse({
        id: 243,
        name: "计算机操作系统",
        course_code: "CS302",
        courseries: "CS302",
        dept: "计算机科学与工程系",
        teachers: [{ id: 200, name: "沈昀", image: "/static/image/teacher.jpg" }],
        review_term_list: [],
        terms: [{ id: 13453, term: "20252", courseries: "CS302" }],
        related_courses: [],
        same_teacher_courses: [],
        rate: {
          rate_average: null,
          review_count: 0,
          difficulty_score: null,
          homework_score: null,
          grading_score: null,
          gain_score: null,
        },
      });
    }
    if (url === "https://ncesnext.com/api/v1/course/243/reviews?term=20252") {
      return jsonResponse({ items: [], total: 0, page: 1, per_page: 20, pages: 0 });
    }
    if (url === "https://ncesnext.com/api/v1/teacher/356") {
      return jsonResponse({
        id: 356,
        name: "刘珂廷",
        email: "liukt@sustech.edu.cn",
        review_count: 23,
        average_rate: 10,
        normalized_rate: 9.71,
        courses: [{
          id: 8381,
          name: "艺术与科学大讲堂",
          course_code: "GEM029",
          teacher_names: "毕宝仪, 刘珂廷",
          term_ids: ["20232"],
          review_count: 0,
          rate_average: null,
          difficulty_score: null,
          homework_score: null,
          grading_score: null,
          gain_score: null,
        }],
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  });

  const course = await getNcesCourseByCode("CS302", { term: "20252", adapter });
  assert.equal(course?.rating, null);
  assert.equal(course?.difficulty, null);
  assert.equal(course?.workload, null);
  assert.equal(course?.grading, null);
  assert.equal(course?.takeaways, null);
  assert.match(formatNcesCourseByCode("CS302", "20252", course), /Community rating unavailable \/ reviews 0/u);
  assert.doesNotMatch(formatNcesCourseByCode("CS302", "20252", course), /Community rating 0 \/ reviews 0/u);
  assert.doesNotMatch(formatNcesDetail(course), /difficulty Hard · workload Heavy · grading Poor · takeaways Low/u);

  const teacher = await getNcesTeacherDetail(356, { adapter });
  assert.equal(teacher?.courses[0]?.rating, null);
  assert.equal(teacher?.courses[0]?.difficulty, null);
  assert.equal(teacher?.courses[0]?.workload, null);
  assert.equal(teacher?.courses[0]?.grading, null);
  assert.equal(teacher?.courses[0]?.takeaways, null);
});

function routeAdapter(route: (url: string, init?: RequestInit) => Response | Promise<Response>): ServiceAdapter {
  return {
    name: "fixture",
    fetch(input: string, init?: RequestInit): Promise<Response> {
      return Promise.resolve(route(String(input), init));
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
