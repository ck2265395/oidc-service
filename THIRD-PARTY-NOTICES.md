# Third-party notices

Runtime dependencies are pinned in `package-lock.json`. Direct runtime dependencies and the license identifiers recorded in that lockfile are:

| Package | Version | License identifier |
| --- | --- | --- |
| express | 5.3.0 | MIT |
| jose | 6.2.13 | MIT |
| nodemailer | 10.2.1 | MIT-0 |
| oidc-provider | 9.13.3 | MIT |
| pg | 8.23.1 | MIT |
| redis | 6.3.0 | MIT |

The transitive production dependency inventory is generated from the lockfile as a CycloneDX SBOM with `npm run sbom`; CI retains it as a workflow artifact for 90 days. Package-specific license texts and notices are distributed by their respective upstream packages. Review the generated SBOM and upstream license terms when preparing a release or redistributing the service.
