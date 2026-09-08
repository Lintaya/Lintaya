# ADR-002: Apache License 2.0 for the Lintaya core

- Status: Accepted
- Date: 2026-08-16

## Context

Lintaya needs a permissive open-source license suitable for individual and
commercial adoption, external contributions, connectors, analyzers, and a
future hosted or enterprise business.

The business may charge for managed cloud services, support, operational
capacity, and separately distributed modules. The public core must remain useful
and independently deployable.

## Decision

The Lintaya core is licensed under the Apache License, Version 2.0. Intentional
contributions accepted into the core use the same license unless a separate
written agreement is established in advance.

Commercial services and separately distributed modules may use different terms
when their dependencies and ownership permit it. They must integrate through
public contracts and must not change the license of the Apache-licensed core.

## Consequences

- The repository includes the complete `LICENSE` and a `NOTICE` file.
- Released Apache-licensed versions remain available under those terms.
- Redistributions must comply with Apache 2.0 attribution and modification
  requirements.
- Community contributions to the core remain Apache-licensed.
- Dual licensing the same contributed code may require additional contributor
  agreements and legal review.
- Lintaya trademark permissions are handled separately from the software
  license.

The product boundary between this repository and future commercial services is
tracked separately, outside the published tree.
