import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  assertReviewState,
  CommandSupport,
  createInitialReviewState,
  DriveKind,
  PlanOptionDefinition,
  printJson,
  printLine,
  printReviewState,
  readOptionalPlanFile,
  resolvePlanFile,
  ReviewStateStore
} from "claude-gdoc-review-plugin"

import { TestEnvironment } from "../support/testEnvironment.js"

describe("resolvePlanFile", () => {
  it("makes a relative plan path absolute", () => {
    expect(resolvePlanFile("plans/a.md")).toBe(path.resolve("plans/a.md"))
  })

  it("keeps an absolute plan path", () => {
    const absolute = path.join(tmpdir(), "a.md")
    expect(resolvePlanFile(absolute)).toBe(absolute)
  })

  it("refuses an empty value", () => {
    expect(() => resolvePlanFile("")).toThrow(
      CommandSupport.MissingPlanFileMessage
    )
    expect(() => resolvePlanFile(null)).toThrow(
      CommandSupport.MissingPlanFileMessage
    )
  })
})

describe("PlanOptionDefinition", () => {
  it("is a required string option", () => {
    expect(PlanOptionDefinition.type).toBe("string")
    expect(PlanOptionDefinition.demandOption).toBe(true)
  })
})

describe("printing helpers", () => {
  let chunks: string[] = []
  let writeSpy: jest.SpyInstance = null

  beforeEach(() => {
    chunks = []
    writeSpy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        chunks.push(String(chunk))
        return true
      })
  })

  afterEach(() => {
    writeSpy.mockRestore()
  })

  it("terminates every printed line", () => {
    printLine("hello")
    expect(chunks.join("")).toBe(`hello${CommandSupport.LineSeparator}`)
  })

  it("prints JSON with the house indentation", () => {
    printJson({ a: 1 })
    expect(chunks.join("")).toBe(
      `{\n  "a": 1\n}${CommandSupport.LineSeparator}`
    )
  })

  it("prints a review state through its codec", () => {
    const state = createInitialReviewState({
      planFile: "/plans/a.md",
      target: {
        kind: DriveKind.personal,
        driveName: null,
        driveId: null,
        path: "plans/A",
        folderId: null
      }
    })

    printReviewState(state)
    expect(JSON.parse(chunks.join("")).planFile).toBe("/plans/a.md")
  })
})

describe("assertReviewState", () => {
  let statePath: string = null
  let store: ReviewStateStore = null

  beforeEach(async () => {
    statePath = await mkdtemp(
      TestEnvironment.newTemporaryDirectoryTemplate("support-")
    )
    store = await ReviewStateStore.create({ stateDirectory: statePath })
  })

  afterEach(async () => {
    await rm(statePath, { recursive: true, force: true })
  })

  it("returns the stored review", async () => {
    const planFile = path.join(statePath, "support-plan.md"),
      state = createInitialReviewState({
        planFile,
        target: {
          kind: DriveKind.personal,
          driveName: null,
          driveId: null,
          path: "plans/Support",
          folderId: null
        }
      })

    await store.save(state)
    expect((await assertReviewState(store, planFile)).planFile).toBe(planFile)
  })

  it("fails when the plan has no review", async () => {
    const planFile = path.join(statePath, "missing-plan.md")

    await expect(assertReviewState(store, planFile)).rejects.toThrow(
      CommandSupport.newMissingReviewMessage(planFile)
    )
  })
})

describe("readOptionalPlanFile", () => {
  it("resolves a plan file and reports an absent flag as none", () => {
    expect(readOptionalPlanFile("plans/a.md")).toBe(path.resolve("plans/a.md"))
    expect(readOptionalPlanFile(null)).toBeNull()
    expect(readOptionalPlanFile("")).toBeNull()
  })

  it("refuses a repeated flag rather than picking one occurrence", () => {
    // The Bash gate checks the first --plan; a command acting on the second
    // would act on a plan the gate never compared against the session's.
    expect(() =>
      readOptionalPlanFile(["plans/a.md", "plans/b.md"] as unknown as string)
    ).toThrow(CommandSupport.RepeatedPlanFileMessage)
  })
})
