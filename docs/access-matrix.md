# Access Matrix

Access = role permission × department scope. Roles derive from Entra ID security groups
(see group mapping below). Enforcement is at the database layer (Postgres RLS), never UI-only.

## Roles
| Role | Scope | Access |
|---|---|---|
| Requester (all staff) | Own records | Portal, submit requests, track own requests |
| Agent | Own department | + My Work, department queue, assign/reassign within dept |
| Team Lead | Own department | + escalations, department insights |
| Approver (DoA) | Own DoA band | + approvals routed to them; read-only queue context |
| Dept Admin | Own department | + catalog builder, SLA settings for their dept |
| Executive | Global, read-only | Cross-department insights, audit log |
| User Admin | Global | Users & Directory: manage users, role assignments, AD group mappings, approval delegation, teams |
| System Admin | Global | System console: feature toggles, email templates + inbound routing, DoA matrix, SLA policies, workflows, announcements, audit viewer, integrations |

> 2026-07-03: the former Platform Admin role was split into User Admin and
> System Admin (separation of duties). See docs/admin-console.md.

## Entra ID group → role mapping
| AD security group | Platform role |
|---|---|
| SG-ABC-ServiceDesk-IT | Agent · IT |
| SG-ABC-Admin-Services | Agent · Administration |
| SG-ABC-Logistics-Ops | Agent · Logistics |
| SG-ABC-TeamLeads-* | Team Lead · per dept |
| SG-ABC-DoA-Approvers | Approver (band from DoA matrix) |
| SG-ABC-Dept-Admins-* | Dept Admin · per dept |
| SG-ABC-Executives | Executive |
| SG-ABC-User-Admins | User Admin |
| SG-ABC-System-Admins | System Admin |
| (all licensed users) | Requester |

## DoA bands (SAR)
Tier 1 < 25,000 · Tier 2 25,000–100,000 · Tier 3 > 100,000
