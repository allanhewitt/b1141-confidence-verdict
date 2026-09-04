import { test, expect } from "@playwright/test";

const API = process.env.E2E_API_BASE || "http://127.0.0.1:4000";
const FACILITATOR_KEY = process.env.E2E_LECTURER_KEY || "stage3-e2e-facilitator-key";

const W1 = "b1141-w1-who-is-excluded";
const W2 = "b1141-w2-bad-apple-or-system-cwd";
const W9 = "b1141-w9-audit-own-confidence";

const forbiddenLearnerVocabulary = /\b(?:B1141|GEDL|CWD|university|module|lecture|commitment|confrontation|resolution|trace|diagnostic)\b/i;

async function expectLearnerFacingVocabulary(page) {
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(forbiddenLearnerVocabulary);
}

async function beginFromLecturer(browser, activityId) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/#/control/${activityId}`);
  await page.getByLabel("Facilitator key").fill(FACILITATOR_KEY);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: "Start session" })).toBeVisible();
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByText("Session open", { exact: true })).toBeVisible();
  return { context, page };
}

async function newRolePage(browser, route) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(route);
  return { context, page };
}

async function chooseConfidence(page, index) {
  const group = page.getByRole("group", { name: "How sure are you?" });
  await group.getByRole("button").nth(index).click();
}

async function chooseAuditRating(page, itemName, value) {
  const group = page.getByRole("group", { name: itemName });
  await group.getByRole("button").nth(value).click();
}

async function apiJson(request, url, options = {}) {
  const response = await request.fetch(url, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload };
}

async function closeAnyOpenSession(request, activityId) {
  const headers = { "X-GEDL-Lecturer-Key": FACILITATOR_KEY };
  for (const base of ["/api/cwd/audit", "/api/cwd"]) {
    const current = await apiJson(request, `${API}${base}/activities/${activityId}/session`);
    if (!current.response.ok()) continue;
    await request.post(`${API}${base}/sessions/${current.payload.id}/close`, { headers });
    return;
  }
}

async function endFromLecturer(page) {
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.getByText("This session has ended.", { exact: true })).toBeVisible();
}

test.afterEach(async ({ request }) => {
  await closeAnyOpenSession(request, W1);
  await closeAnyOpenSession(request, W2);
  await closeAnyOpenSession(request, W9);
});

test("W1 social-immediate works across Student, Lecturer and Presentation surfaces", async ({ browser }) => {
  const lecturer = await beginFromLecturer(browser, W1);
  const student = await newRolePage(browser, `/#/respond/${W1}`);
  const presentation = await newRolePage(browser, `/#/display/${W1}`);

  try {
    await expect(student.page.getByRole("heading", { name: /Which of these benefits/ })).toBeVisible();
    await expect(presentation.page.getByRole("heading", { name: /Which of these benefits/ })).toBeVisible();
    await expect(presentation.page.locator(".cwd-presentation-count > strong")).toHaveText("0");
    await expect(presentation.page.locator(".cwd-cohort-dot")).toHaveCount(0);
    await expectLearnerFacingVocabulary(student.page);
    await expectLearnerFacingVocabulary(presentation.page);

    await student.page.getByRole("button", { name: "Better health and wellbeing" }).click();
    await chooseConfidence(student.page, 3);
    await student.page.getByRole("button", { name: "That’s my answer" }).click();
    await expect(student.page.getByRole("heading", { name: /show the group responses shortly/i })).toBeVisible();

    await expect(lecturer.page.getByText("1 responses", { exact: true }).first()).toBeVisible();
    await expect(lecturer.page.getByRole("heading", { name: "Responses remain hidden" })).toBeVisible();
    await expect(lecturer.page.locator(".cwd-cohort-dot")).toHaveCount(0);
    await expect(presentation.page.locator(".cwd-presentation-count > strong")).toHaveText("1");
    await expect(presentation.page.getByText("response in", { exact: true })).toBeVisible();
    await expect(presentation.page.locator(".cwd-cohort-dot")).toHaveCount(0);

    await lecturer.page.getByRole("button", { name: "Show group responses" }).click();
    await expect(student.page.getByRole("heading", { name: /Here’s what everyone said/i })).toBeVisible();
    await expect(presentation.page.getByRole("heading", { name: /Here’s what the group said/i })).toBeVisible();
    await expect(presentation.page.locator(".cwd-cohort-dot").first()).toBeVisible();

    await student.page.getByRole("button", { name: "Keep going" }).click();
    await expect(student.page.getByText("Something to think about", { exact: true })).toBeVisible();
    await student.page.getByRole("button", { name: "Think again" }).click();
    await expect(student.page.getByRole("heading", { name: "What changed — if anything?" })).toBeVisible();
    await student.page.getByRole("button", { name: "I would keep my answer and feel about as confident" }).click();
    await student.page.getByRole("button", { name: "Finish" }).click();
    await expect(student.page.getByRole("heading", { name: "That’s it." })).toBeVisible();
    await expectLearnerFacingVocabulary(student.page);

    await endFromLecturer(lecturer.page);
  } finally {
    await student.context.close();
    await presentation.context.close();
    await lecturer.context.close();
  }
});

test("W2 social-delayed preserves the teaching gap and lecturer-controlled final response", async ({ browser }) => {
  const lecturer = await beginFromLecturer(browser, W2);
  const student = await newRolePage(browser, `/#/respond/${W2}`);
  const presentation = await newRolePage(browser, `/#/display/${W2}`);

  try {
    await expect(student.page.getByRole("heading", { name: /where does the main explanation usually lie/i })).toBeVisible();
    await student.page.getByRole("button", { name: "Mainly with the individual involved" }).click();
    await chooseConfidence(student.page, 2);
    await student.page.getByRole("button", { name: "That’s my answer" }).click();
    await expect(presentation.page.locator(".cwd-presentation-count > strong")).toHaveText("1");

    await lecturer.page.getByRole("button", { name: "Show group responses" }).click();
    await expect(student.page.getByRole("heading", { name: /Here’s what everyone said/i })).toBeVisible();
    await student.page.getByRole("button", { name: "Keep going" }).click();
    await expect(student.page.getByRole("heading", { name: "There’s one more response to make." })).toBeVisible();
    await expect(presentation.page.getByRole("heading", { name: /Here’s what the group said/i })).toBeVisible();
    await expect(lecturer.page.getByRole("button", { name: "Open final response" })).toBeVisible();

    await lecturer.page.getByRole("button", { name: "Open final response" }).click();
    await expect(student.page.getByRole("heading", { name: "What changed — if anything?" })).toBeVisible();
    await expect(presentation.page.getByRole("heading", { name: "What changed — if anything?" })).toBeVisible();

    await student.page.getByRole("button", { name: "I would keep my answer and feel about as confident" }).click();
    await student.page.getByRole("button", { name: "Finish" }).click();
    await expect(student.page.getByRole("heading", { name: "That’s it." })).toBeVisible();
    await expectLearnerFacingVocabulary(student.page);
    await expectLearnerFacingVocabulary(presentation.page);

    await endFromLecturer(lecturer.page);
  } finally {
    await student.context.close();
    await presentation.context.close();
    await lecturer.context.close();
  }
});

test("W9 self-audit runs privately while Lecturer sees aggregate needs and Presentation reveals no group diagnostic", async ({ browser }) => {
  const lecturer = await beginFromLecturer(browser, W9);
  const student = await newRolePage(browser, `/#/respond/${W9}`);
  const presentation = await newRolePage(browser, `/#/display/${W9}`);

  try {
    await expect(student.page.getByRole("heading", { name: /For each lens/ })).toBeVisible();
    await expect(presentation.page.getByText("Work through this on your own device.", { exact: true })).toBeVisible();
    await expect(presentation.page.locator(".cwd-cohort-dot")).toHaveCount(0);
    await expectLearnerFacingVocabulary(student.page);
    await expectLearnerFacingVocabulary(presentation.page);

    await chooseAuditRating(student.page, "Functionalism", 2);
    await chooseAuditRating(student.page, "Conflict Theory and Hegemony", 1);
    await chooseAuditRating(student.page, "Intersectionality", 1);
    await chooseAuditRating(student.page, "Self-Determination Theory", 3);
    await chooseAuditRating(student.page, "Foucault's Surveillance", 2);
    await chooseAuditRating(student.page, "Ethical Frameworks", 3);
    await student.page.getByRole("button", { name: "That’s my check-in" }).click();

    await expect(student.page.getByRole("heading", { name: "These are your lowest-rated areas." })).toBeVisible();
    await student.page.getByRole("button", { name: /Intersectionality/ }).click();
    await expect(student.page.getByRole("heading", { name: "Intersectionality" })).toBeVisible();
    await expect(student.page.getByText(/social positions such as race, gender, class and disability/i)).toBeVisible();
    await student.page.getByRole("button", { name: "Rate yourself again" }).click();

    const rerating = student.page.getByRole("group", { name: "Rate Intersectionality again" });
    await rerating.getByRole("button").nth(2).click();
    await student.page.getByRole("button", { name: "Finish" }).click();
    await expect(student.page.getByRole("heading", { name: "That’s it." })).toBeVisible();

    await expect(lecturer.page.getByText("1 responses", { exact: true }).first()).toBeVisible();
    const intersectionalityRow = lecturer.page.locator(".cwd-diagnostic-row").filter({ hasText: "Intersectionality" });
    await expect(intersectionalityRow).toContainText("1 chose this to revisit");
    await expect(presentation.page.getByText("Work through this on your own device.", { exact: true })).toBeVisible();
    await expect(presentation.page.locator(".cwd-cohort-dot")).toHaveCount(0);
    await expectLearnerFacingVocabulary(student.page);
    await expectLearnerFacingVocabulary(presentation.page);

    await endFromLecturer(lecturer.page);
  } finally {
    await student.context.close();
    await presentation.context.close();
    await lecturer.context.close();
  }
});
