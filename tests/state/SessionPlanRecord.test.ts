import {
  SessionPlanRecord,
  SessionPlanRecordCodec
} from "claude-gdoc-review-plugin"

const Record: SessionPlanRecord = {
  planFile: "/tmp/plans/my-plan.md",
  transcriptMtimeMs: 1_700_000_000_123.5,
  transcriptSize: 8_192
}

describe("SessionPlanRecordCodec", () => {
  it("round-trips a record through JSON", () => {
    expect(
      SessionPlanRecordCodec.parse(SessionPlanRecordCodec.serialize(Record))
    ).toEqual(Record)
  })

  it("reads a legacy bare path as no record at all", () => {
    expect(SessionPlanRecordCodec.parse("/tmp/plans/my-plan.md")).toBeNull()
  })

  it("reads malformed, empty and incomplete entries as no record", () => {
    expect(SessionPlanRecordCodec.parse("{ broken")).toBeNull()
    expect(SessionPlanRecordCodec.parse("")).toBeNull()
    expect(SessionPlanRecordCodec.parse(null)).toBeNull()
    expect(
      SessionPlanRecordCodec.parse(JSON.stringify({ planFile: "/tmp/p.md" }))
    ).toBeNull()
    expect(
      SessionPlanRecordCodec.parse(JSON.stringify({ ...Record, planFile: "" }))
    ).toBeNull()
  })

  it("refuses to serialize a record that is not one", () => {
    expect(() =>
      SessionPlanRecordCodec.serialize({ ...Record, planFile: "" })
    ).toThrow()
  })
})
