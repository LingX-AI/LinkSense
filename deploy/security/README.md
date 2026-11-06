# Release image vulnerability policy

The maintainer-selected policy is `application-owned-v1`.

- Scan and retain the complete HIGH/CRITICAL reports for both architectures.
- Record vulnerabilities in external service images and independently maintained
  runtime baselines; they do not block a product release or baseline maintenance.
- For an application image, read the immutable runtime index used by the build.
  Verify the architecture and that its full root-filesystem layer sequence is an
  exact prefix of the scanned application image. A finding is inherited only
  when its Trivy `Layer.DiffID` belongs to those verified baseline layers.
- Block HIGH/CRITICAL findings introduced by application layers. Missing or
  unrecognized layer evidence is not an inherited-baseline exemption.
- Keep the production Node dependency audit, source/secret checks, immutable
  image validation, native runtime smoke tests, storage preservation, and
  Core/Full installation, repair and upgrade checks blocking.
- Failed scanners, invalid reports and unavailable or mismatched image metadata
  always block. No remote ignore policy or ambient Trivy configuration is used.

`*.policy.json` preserves each finding's component, version, severity and
attribution. `passed_with_external_risks` means the application gate passed with
reported external risks, not that the affected dependencies were fixed or safe.
This policy does not assess or patch a deployment host's kernel.

The maintainer accepted `GHSA-mrwp-f3q8-3g9p` / `CVE-2026-116689` in
`follow-redirects@1.16.1` for **v0.3.13 only**. The exact scope and decision are
recorded in [the release acceptance record](v0.3.13-risk-acceptance.json).
The current source upgrades this dependency to `1.16.2` and no longer ignores
the advisory in the Node audit. A regression check prevents restoring that
obsolete ignore. The acceptance record remains historical evidence for the
exact `1.16.1` release artifacts. Image scans retain the complete findings and
label a matching HIGH npm finding as
accepted application risk, never fixed or external. Other advisories, package
versions, higher severities, missing release identity, invalid provenance and
scan failures remain blocking. `passed_with_accepted_application_risks` records
this decision explicitly. Any future advisory acceptance requires a new
specific review.

Baseline maintenance invokes the scanner with the explicit `baseline` scope:
its images contain environment components, not the LinkSense application server.
Product releases use the explicit `application` scope with frozen runtime inputs.
