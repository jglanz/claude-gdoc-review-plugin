import {
  CliSubcommand,
  createCliAllowlistMatcher,
  GatedCliSubcommand,
  ShellUtils
} from "claude-gdoc-review-plugin"

const BundleFile =
    "/opt/plugins/claude-gdoc-review-plugin/dist/gdoc-review.cjs",
  LauncherFile = "/opt/plugins/claude-gdoc-review-plugin/bin/gdoc-review"

describe("shellUtils", () => {
  const matches = createCliAllowlistMatcher([BundleFile, LauncherFile])

  describe("ShellUtils", () => {
    it("normalizes a flag name to one comparable spelling", () => {
      expect(ShellUtils.normalizeFlagName("state-dir")).toBe("statedir")
      expect(ShellUtils.normalizeFlagName("stateDir")).toBe("statedir")
      expect(ShellUtils.normalizeFlagName("STATE_DIR")).toBe("statedir")
    })

    it("reads every long flag name a command carries", () => {
      expect(
        ShellUtils.readLongFlagNames(
          `node x status --json --plan=/tmp/p.md --drive-name X`
        )
      ).toEqual(["json", "plan", "drivename"])
      expect(ShellUtils.readLongFlagNames("node x status")).toEqual([])
    })

    it("names a flag list for every auto-allowed subcommand", () => {
      Object.values(CliSubcommand).forEach(subcommand => {
        expect(ShellUtils.AllowedFlagNamesBySubcommand[subcommand]).toContain(
          "plan"
        )
      })
      expect(
        ShellUtils.hasOnlyAllowedFlags("node x whatever --plan p", "")
      ).toBe(false)
    })
  })

  describe("createCliAllowlistMatcher", () => {
    it("demands at least one script path", () => {
      expect(() => createCliAllowlistMatcher([])).toThrow()
      expect(() => createCliAllowlistMatcher([""])).toThrow()
    })

    it("allows a plain node invocation of every subcommand", () => {
      Object.values(CliSubcommand).forEach(subcommand => {
        const match = matches(`node "${BundleFile}" ${subcommand}`)

        expect(match.allowed).toBe(true)
        expect(match.subcommand).toBe(subcommand)
      })
    })

    it("allows the launcher without node and without quotes", () => {
      const match = matches(`${LauncherFile} status --json`)

      expect(match.allowed).toBe(true)
      expect(match.subcommand).toBe(CliSubcommand.status)
    })

    it("tolerates leading whitespace", () => {
      expect(matches(`   node ${BundleFile} status`).allowed).toBe(true)
    })

    it("extracts a bare, a quoted and an equals-form --plan value", () => {
      expect(
        matches(`node "${BundleFile}" register --plan /tmp/plans/a.md`).planFile
      ).toBe("/tmp/plans/a.md")
      expect(
        matches(`node "${BundleFile}" register --plan "/tmp/my plans/a.md"`)
          .planFile
      ).toBe("/tmp/my plans/a.md")
      expect(
        matches(`node "${BundleFile}" register --plan='/tmp/plans/b.md'`)
          .planFile
      ).toBe("/tmp/plans/b.md")
    })

    it("rejects the subcommands that write what the gate trusts", () => {
      Object.values(GatedCliSubcommand).forEach(subcommand => {
        const match = matches(
          `node "${BundleFile}" ${subcommand} --plan /tmp/plans/a.md`
        )

        expect(match.allowed).toBe(false)
        expect(match.subcommand).toBeNull()
      })
    })

    it("rejects a state directory override in every spelling", () => {
      expect(
        matches(`node "${BundleFile}" status --state-dir /tmp/elsewhere`)
          .allowed
      ).toBe(false)
      expect(
        matches(`node "${BundleFile}" init --state-dir=/tmp/elsewhere`).allowed
      ).toBe(false)
      expect(
        matches(`node "${BundleFile}" status --stateDir /tmp/elsewhere`).allowed
      ).toBe(false)
      expect(
        matches(`node "${BundleFile}" status --state_dir /tmp/elsewhere`)
          .allowed
      ).toBe(false)
      expect(
        matches(`node "${BundleFile}" status --STATE-DIR /tmp/elsewhere`)
          .allowed
      ).toBe(false)
    })

    it("allows exactly the flags its subcommand takes", () => {
      expect(
        matches(
          `node "${BundleFile}" init --plan /tmp/p.md --kind shared --drive-name Engineering --path "a/b/C"`
        ).allowed
      ).toBe(true)
      expect(
        matches(
          `node "${BundleFile}" register --plan /tmp/p.md --doc-id d --doc-url u --folder-id f --drive-id dr --server workspace --sync-mode content`
        ).allowed
      ).toBe(true)
      expect(
        matches(
          `node "${BundleFile}" log-thread --plan /tmp/p.md --comment-id c`
        ).allowed
      ).toBe(true)
    })

    it("rejects a flag another subcommand owns", () => {
      expect(
        matches(`node "${BundleFile}" status --comment-id c`).allowed
      ).toBe(false)
      expect(
        matches(`node "${BundleFile}" target --kind personal`).allowed
      ).toBe(false)
    })

    it("rejects init --force, which replaces an existing review", () => {
      expect(
        matches(
          `node "${BundleFile}" init --plan /tmp/p.md --kind personal --path "a/b/C" --force`
        ).allowed
      ).toBe(false)
      expect(
        ShellUtils.NeverAllowedFlagNamesBySubcommand[CliSubcommand.init]
      ).toContain("force")
    })

    it("rejects a flag no subcommand takes at all", () => {
      expect(matches(`node "${BundleFile}" status --help`).allowed).toBe(false)
      expect(
        matches(`node "${BundleFile}" status --json --verbose`).allowed
      ).toBe(false)
    })

    it("rejects a subcommand that is only a prefix of the typed word", () => {
      expect(matches(`node "${BundleFile}" status--state-dir`).allowed).toBe(
        false
      )
      expect(matches(`node "${BundleFile}" init.sh`).allowed).toBe(false)
    })

    it("reports a null plan file when the flag is absent", () => {
      expect(matches(`node "${BundleFile}" status`).planFile).toBeNull()
    })

    it("rejects a chained destructive command", () => {
      expect(
        matches(`node "${BundleFile}" status && rm -rf /tmp/plans`).allowed
      ).toBe(false)
      expect(
        matches(`node "${BundleFile}" status ; rm -rf /tmp/plans`).allowed
      ).toBe(false)
    })

    it("rejects command substitution, backticks, pipes and redirection", () => {
      expect(matches(`node "${BundleFile}" status $(whoami)`).allowed).toBe(
        false
      )
      expect(matches("node " + BundleFile + " status `whoami`").allowed).toBe(
        false
      )
      expect(
        matches(`node "${BundleFile}" status | tee /tmp/out`).allowed
      ).toBe(false)
      expect(matches(`node "${BundleFile}" status > /tmp/out`).allowed).toBe(
        false
      )
      expect(matches(`node "${BundleFile}" status < /tmp/in`).allowed).toBe(
        false
      )
    })

    it("rejects a newline-smuggled second command", () => {
      expect(
        matches(`node "${BundleFile}" status\nrm -rf /tmp/plans`).allowed
      ).toBe(false)
    })

    it("rejects another script and a prefix of the allowed path", () => {
      expect(matches("node /opt/other/gdoc-review.cjs status").allowed).toBe(
        false
      )
      expect(matches(`node "${BundleFile}.backup" status`).allowed).toBe(false)
    })

    it("rejects an unknown subcommand and a missing one", () => {
      expect(matches(`node "${BundleFile}" publish`).allowed).toBe(false)
      expect(matches(`node "${BundleFile}" statuses`).allowed).toBe(false)
      expect(matches(`node "${BundleFile}"`).allowed).toBe(false)
    })

    it("rejects an empty command", () => {
      const match = matches("")

      expect(match.allowed).toBe(false)
      expect(match.subcommand).toBeNull()
      expect(match.planFile).toBeNull()
    })
  })
})
