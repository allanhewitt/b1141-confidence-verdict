import { test, expect } from "@playwright/test";

const API = process.env.E2E_API_BASE || "http://127.0.0.1:4000";
const FACILITATOR_KEY = process.env.E2E_LECTURER_KEY || "stage3-e2e-facilitator-key";
const W1 = "b1141-w1-who-is-excluded";

async function closeAnyOpenSession(request) {
  const headers = { "X-GEDL-Lecturer-Key": FACILITATOR_KEY };
  const current = await request.get(`${API}/api/cwd/activities/${W1}/session`);
  if (!current.ok()) return;
  const session = await current.json();
  await request.post(`${API}/api/cwd/sessions/${session.id}/close`, { headers });
}

async function startSession(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/control/${W1}`);
  await page.getByLabel("Facilitator key").fill(FACILITATOR_KEY);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByText("Session open", { exact: true })).toBeVisible();
  return { context, page };
}

test.afterEach(async ({ request }) => {
  await closeAnyOpenSession(request);
});

test("cwd01 keeps the public alias in the address bar while loading the canonical activity", async ({ browser }) => {
  const lecturer = await startSession(browser);
  const studentContext = await browser.newContext();
  const student = await studentContext.newPage();

  try {
    await student.goto("/cwd01");
    await expect(student.getByRole("heading", { name: /Which of these benefits/ })).toBeVisible();

    const url = new URL(student.url());
    expect(url.pathname).toBe("/cwd01");
    expect(student.url()).not.toContain("respond");
    expect(student.url()).not.toContain(W1);
  } finally {
    await studentContext.close();
    await lecturer.context.close();
  }
});

test("legacy hash routes continue to resolve during the transition", async ({ browser }) => {
  const lecturer = await startSession(browser);
  const studentContext = await browser.newContext();
  const student = await studentContext.newPage();

  try {
    await student.goto(`/#/respond/${W1}`);
    await expect(student.getByRole("heading", { name: /Which of these benefits/ })).toBeVisible();
    expect(new URL(student.url()).pathname).toBe(`/respond/${W1}`);
  } finally {
    await studentContext.close();
    await lecturer.context.close();
  }
});
