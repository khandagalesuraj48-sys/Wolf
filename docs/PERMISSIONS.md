# FALCON – roles, screens and permissions

**Proposed from the approved designs and his brief – for his approval; he changes any line.** Every rule here is enforced by the database (Row Level Security) and the server's checks – a hidden button is never the only
guard. A person sees only his **company** and the **sites** he was given. Board names (`e03`, `w08` …) are in
`docs/DESIGN_INVENTORY.md`.

## The ten roles

| Role | Home | Screens | May do | Sees | May never |
|---|---|---|---|---|---|
| **Employee** | Mess home `Main` | `e02`–`e16`; first time `r01`–`r08` | ask a meal / parcel / delivery to his section; group request (when allowed); confirm with his code or in the app; say the quantity he got; review (optional); complaint with photo / voice; ask for a guest | his own requests, orders, deliveries, complaints; today's menu; the van of his own delivery while it is on the way | another person's orders; contractor money, rates or bills; attendance |
| **Guest** | `g02` | `r01`, `g01`–`g03` | start a visit; order at the mess / parcel / delivery – waits for the host's OK; review; complaint | only his own profile, visits and orders | anybody else's data; prices other than his own bill line |
| **Mess Owner** | `o01` | `o01`–`o16` | accept / refuse a request (with reason); prepare, ready; parcels by section; make a batch; choose driver and vehicle; route; dispatch; publish the menu; guest meals; daily closing remarks; reply to complaints; phone follow-up; his bills and documents | his mess's requests, orders, batches, complaints, closing, bills of his own work order | attendance (never changes it); other contractors; RCL's approvals |
| **Mess Operator** | `o04` | `o02`, `o04`–`o06`, `o09`, `o10`, `o11` | the kitchen steps; packing; batches and dispatch when the owner lets him | today's work of his mess | money, rates, bills, documents, complaints' decisions |
| **Mess Supervisor** (RCL) | `w07` | `w01` (his site), `w07`, `w14`, `w11` (operations) | check and close the day; a correction after the lock only with the reason and the Site Admin's OK; decide a complaint (true / not); supervisor confirmation | his site's meals, deliveries, complaints | rates, bills, payments |
| **Driver** | `d01` | `d01`–`d11` | accept a batch; check the vehicle; route; deliver with the code; short given; failed with reason; summary | **only the batches given to him**, with each stop's names and quantities | other batches; prices; anybody's code (he types the code the person tells him) |
| **Site Admin** | `w01` | `w01`–`w07`, `w11`, `w12`, `w14`–`w17` for his site | sections, mess, menu times; documents; registrations (verify, link, ask HR, temporary, section, reject, suspend, ask details); first approval of a bill; penalty decision | everything of his site | other sites; payment release |
| **Accounts** | `w10` | `w05`, `w06`, `w08`–`w11`, `w15` | GST / TDS settings with dates (the CA's check); check a bill and its deductions; reconciliation; approve / send back / hold with reason; enter the payment (UTR) | bills, rates, work orders, documents, payments of his sites | change a verified meal count; approve his own entry |
| **Management** | `w01` (all sites) | `w01`, `w10`–`w14` | approve a payment; send back / hold with reason | every site's figures, scorecards, complaints | change entries |
| **System Admin** | `w01` | all web pages + users, roles, settings | sites and sections (each with its place and metres); mess and contractor masters; work orders and rates (with Accounts); roles and who has them; settings (windows, cut-off times, weights) | everything of his company; the audit log | delete history; approve a bill alone; change a payment |

Nobody approves his own entry; each step of a bill is a different person. Send back, Hold, Reject, Suspend and every correction
need the reason.

## Registration states

| State | Means | What he may do |
|---|---|---|
| Mobile verification pending | the WhatsApp code is not entered yet | nothing |
| WhatsApp verified | the mobile is his – not yet more | goes on to the RCL ID / new registration |
| Employee ID found | his RCL ID is in HR – the form is filled from HR | confirms it is him |
| Employee ID not found | the ID is not in HR (new, not added yet, typed wrong) | checks the ID or registers as new |
| New employee registration | registered without an HR record | waits |
| Pending admin / HR verification | the Site Admin or HR has to check him | waits; temporary use only if given |
| Temporary registered user | the Site Admin allowed limited use till a date | the meals the Site Admin allowed, at his site |
| Verified employee | found in HR and the mobile matches, or verified by the Site Admin / HR | everything an Employee may do |
| Employee ID assigned | HR made his record and gave the ID (HR's own steps) | his FALCON record is linked to it |
| Linked to existing employee | joined to an HR record that already existed | his earlier meals moved to it, history kept |
| Rejected | not working here / false | nothing; the reason is kept |
| Suspended | stopped by the Site Admin / System Admin | nothing until released; the reason is kept |

The WhatsApp code proves the mobile only. No RCL ID is ever made up in FALCON; only HR gives it. Linking never makes a second
record and never loses a meal.

## Guests
One profile for ever (the same mobile cannot open a second one); each visit is its own record with its orders. Coming back: the
verified mobile; a known phone only suggests the profile; a WhatsApp code on a new phone, after 30 days, or whenever the match is
doubtful – nobody can walk in as another guest. A guest's order is counted apart from employees' and billed at the guest rate.

## Alerts (who is told)
* New request / change window closing → Mess Owner.
* Order accepted, ready, on the way, near, delivered → the person (and the group requester for his group).
* A batch given → the Driver.
* Not confirmed → the owner's follow-up list.
* Complaint → Mess Owner at once; a serious one (cleanliness, health) → Site Admin and HSE at once; open too long → again.
* Daily closing not done → Supervisor, then Site Admin.
* New site user, HR record not found → Site Admin and HR ("New site user registered – HR employee record not found").
* Temporary access ending → the person and the Site Admin.
* Document ending in 60 / 30 / 7 days and on the day → Site Admin, Accounts, the contractor.
* A bill waiting at a step → that step's person.
