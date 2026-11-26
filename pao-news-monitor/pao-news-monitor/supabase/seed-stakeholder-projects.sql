-- Stakeholder Project Tracker: starting list of 38 projects (IASB, IAASB, IESBA, IPSASB, ISSB)
-- From pre_implementation_standards.csv. Run supabase/update-23.sql first, then paste this whole file into
-- Supabase > SQL Editor > New query and press Run. Safe to run more than once: nothing is added twice.
--
-- Every project is added with its stage, next milestone, effective date and notes from the spreadsheet in its
-- description (shown under its name). Only a date written as a real day becomes a date on the calendar
-- (15 of them). Approximate dates such as "Q4 2026", "H1 2027" or "Dec 2026" stay in the description,
-- because the calendar needs a day. When one becomes a real day, add it with + Add date on the project.
-- A "comments closed on ..." date is added as a single day on the calendar (the day the comments closed), because
-- the spreadsheet doesn't give the day the consultation opened.
-- If you delete an imported date or project on the tracker and run this file again, it comes back.

insert into public.std_projects (id, pao_id, title, description, status, source, created_by)
select v.id, v.pao_id, v.title, v.description, v.status, 'manual', 'import: pre_implementation_standards.csv'
from (values
  ('iasb-risk-mitigation-accounting-ifrs-9-ifrs-7-0d7e', 'iasb', 'Risk Mitigation Accounting (IFRS 9 / IFRS 7)', 'Stage: Exposure Draft - comments open · Next milestone: 30 Nov 2026 (extended)', 'active'),
  ('iasb-ifrs-18-amendments-maintenance-9872', 'iasb', 'IFRS 18 amendments (maintenance)', 'Stage: Exposure Draft expected · Next milestone: Expected Dec 2026 · Effective: IFRS 18 effective 1 Jan 2027 (verify) · Notes: Dec 2026 is the ED date only; it does not change the effective date', 'active'),
  ('iasb-presentation-of-taxes-or-other-charges-t-30dd', 'iasb', 'Presentation of Taxes or Other Charges that Are Not Tax Expense or Income', 'Stage: Permission to ballot · Next milestone: Q4 2026', 'active'),
  ('iasb-business-combinations-disclosures-goodwi-81b3', 'iasb', 'Business Combinations - Disclosures; Goodwill and Impairment', 'Stage: Exposure Draft - redeliberation · Next milestone: Issue expected H1 2027', 'active'),
  ('iasb-equity-method-0ebe', 'iasb', 'Equity Method', 'Stage: Exposure Draft - redeliberation · Next milestone: Issue expected H1 2027', 'active'),
  ('iasb-financial-instruments-with-characteristi-2a87', 'iasb', 'Financial Instruments with Characteristics of Equity', 'Stage: Exposure Draft - redeliberation · Next milestone: Issue expected 2027', 'active'),
  ('iasb-amortised-cost-measurement-ifrs-9-4e05', 'iasb', 'Amortised Cost Measurement (IFRS 9)', 'Stage: Exposure Draft expected · Next milestone: H2 2026', 'active'),
  ('iasb-statement-of-cash-flows-and-related-matt-6b3a', 'iasb', 'Statement of Cash Flows and Related Matters', 'Stage: Work plan project · Next milestone: Expected 2027', 'active'),
  ('iasb-intangible-assets-afa7', 'iasb', 'Intangible Assets', 'Stage: Research / early stage · Next milestone: H2 2026', 'active'),
  ('iasb-ifrs-9-hedge-accounting-post-implementat-f6b6', 'iasb', 'IFRS 9 hedge accounting post-implementation review', 'Stage: Request for Information · Next milestone: Comments close 26 Jan 2027', 'active'),
  ('iasb-ifrs-for-smes-narrow-scope-amendments-co-0f19', 'iasb', 'IFRS for SMEs narrow-scope amendments (consolidation exception)', 'Stage: Consultation closed 9 Sep 2026 · Next milestone: Planned issue Dec 2026 · Effective: 1 Jan 2027 · Notes: Aligned with IFRS for SMEs third edition', 'active'),
  ('iasb-ifrs-20-regulatory-assets-and-regulatory-203e', 'iasb', 'IFRS 20 Regulatory Assets and Regulatory Liabilities', 'Stage: Issued 2026 · Effective: Not confirmed', 'active'),
  ('iasb-cryptoassets-86d4', 'iasb', 'Cryptoassets', 'Stage: Added to work plan Nov 2026', 'active'),
  ('iasb-targeted-improvements-to-ifrs-16-leases-66f1', 'iasb', 'Targeted improvements to IFRS 16 Leases', 'Stage: Added to work plan Nov 2026', 'active'),
  ('iaasb-audit-evidence-and-risk-response-isa-330-7487', 'iaasb', 'Audit Evidence and Risk Response (ISA 330 / 500 / 520)', 'Stage: Exposure Draft - out for comment · Next milestone: Final targeted Q2 2027', 'active'),
  ('iaasb-isa-for-less-complex-entities-first-revi-eb1f', 'iaasb', 'ISA for Less Complex Entities (first revision)', 'Stage: Exposure Draft issued 22 Jul 2026 · Next milestone: Comments closed 17 Nov 2026', 'active'),
  ('iaasb-isa-500-series-revising-isa-501-and-505-1296', 'iaasb', 'ISA 500 Series (revising ISA 501 and 505)', 'Stage: Exposure Draft development · Next milestone: Final targeted Q1 2028', 'active'),
  ('iaasb-isre-2410-revised-interim-financial-info-7919', 'iaasb', 'ISRE 2410 (Revised) - interim financial information review', 'Stage: Exposure Draft - consultation closed · Next milestone: Comments closed 3 Sep 2026', 'active'),
  ('iaasb-narrow-scope-amendments-from-iesba-exter-a886', 'iaasb', 'Narrow-scope amendments from IESBA external experts project', 'Stage: Exposure Draft review · Next milestone: IAASB review Dec 2026', 'active'),
  ('iaasb-technology-and-other-subject-matter-assu-29c4', 'iaasb', 'Technology and other subject-matter assurance areas', 'Stage: Project proposal / information gathering', 'active'),
  ('iaasb-post-implementation-review-of-isa-315-re-e68d', 'iaasb', 'Post-implementation review of ISA 315 (Revised 2019)', 'Stage: Implementation · Effective: Already in force', 'active'),
  ('iesba-using-the-work-of-an-external-expert-c5de', 'iesba', 'Using the Work of an External Expert', 'Stage: Approved · Effective: Dec 2026 (value-chain independence provisions Jul 2028)', 'active'),
  ('iesba-sustainability-reporting-and-assurance-i-3703', 'iesba', 'Sustainability reporting and assurance (IESSA)', 'Stage: Approved · Effective: Periods beginning on or after 15 Dec 2026 (value-chain provisions Jul 2028)', 'active'),
  ('iesba-restructured-code-post-implementation-re-18e0', 'iesba', 'Restructured Code post-implementation review', 'Stage: Survey closed · Next milestone: Final report Dec 2026 · Effective: Restructured Code already in force', 'active'),
  ('iesba-noclar-post-implementation-review-e1d9', 'iesba', 'NOCLAR post-implementation review', 'Stage: Survey closed · Next milestone: Final report Mar 2027', 'active'),
  ('iesba-exposure-drafts-safeguards-part-c-inform-924a', 'iesba', 'Exposure drafts: Safeguards; Part C (information and pressure); inducements; long association; non-assurance services; others', 'Stage: Status not confirmed · Next milestone: Not confirmed · Effective: Not confirmed · Notes: Verify on ethicsboard.org', 'active'),
  ('iesba-2028-2031-strategy-and-work-plan-991f', 'iesba', '2028-2031 Strategy and Work Plan', 'Stage: Consultation paper planned · Next milestone: Approval late 2026; public consultation 2027', 'active'),
  ('ipsasb-ed-94-linkages-with-gfs-manual-2014-amen-599e', 'ipsasb', 'ED 94: Linkages with GFS Manual 2014 (amends IPSAS 22)', 'Stage: Exposure Draft - comments closed · Next milestone: 22 Jun 2026', 'active'),
  ('ipsasb-ed-95-improvements-to-ipsas-vol-10-673f', 'ipsasb', 'ED 95: Improvements to IPSAS Vol 10', 'Stage: Exposure Draft - comments closed · Next milestone: 30 Jun 2026', 'active'),
  ('ipsasb-ed-96-definition-of-an-operation-and-acq-f7b0', 'ipsasb', 'ED 96: Definition of an Operation and Acquired Liabilities (amends IPSAS 40)', 'Stage: Exposure Draft - comments closed · Next milestone: 30 Jun 2026', 'active'),
  ('ipsasb-presentation-of-financial-statements-e853', 'ipsasb', 'Presentation of Financial Statements', 'Stage: Consultation Paper (publication expected Q2 2026) · Next milestone: Status not confirmed · Notes: 120-day comment period if published', 'active'),
  ('ipsasb-climate-related-disclosures-public-polic-a7a1', 'ipsasb', 'Climate-related Disclosures (public policy outcomes)', 'Stage: Ongoing · Notes: SRS 1 published Jan 2026', 'active'),
  ('ipsasb-work-program-consultation-b783', 'ipsasb', 'Work Program Consultation', 'Stage: Closed 4 May 2026 · Next milestone: Decisions during 2026', 'active'),
  ('ipsasb-ipsas-51-tangible-natural-resources-held-95cb', 'ipsasb', 'IPSAS 51 Tangible Natural Resources Held for Conservation', 'Stage: Published Jan 2026 · Effective: Not confirmed', 'active'),
  ('issb-enhancing-sasb-standards-phase-1-nine-st-a63a', 'issb', 'Enhancing SASB Standards - phase 1 (nine standards)', 'Stage: Exposure Draft - ISSB considering feedback · Next milestone: Comments closed 30 Nov 2025', 'active'),
  ('issb-enhancing-sasb-standards-remaining-three-8665', 'issb', 'Enhancing SASB Standards - remaining three standards', 'Stage: Exposure Draft · Next milestone: Comments closed 24 Jul 2026 · Effective: 12-18 months after issue', 'active'),
  ('issb-ifrs-s2-ghg-emissions-amendments-cca9', 'issb', 'IFRS S2 GHG emissions amendments', 'Stage: Issued Dec 2025 · Effective: Periods beginning on or after 1 Jan 2027', 'active'),
  ('issb-nature-related-disclosures-renamed-from--3eac', 'issb', 'Nature-related disclosures (renamed from biodiversity)', 'Stage: Exposure Draft expected H2 2026', 'active')
) as v(id, pao_id, title, description, status)
where exists (select 1 from public.paos p where p.id = v.pao_id)
on conflict (id) do nothing;

insert into public.std_events (project_id, type, title, start_date, end_date, notes, source, created_by)
select v.project_id, v.type, v.title, v.start_date::date, v.end_date::date, v.notes, 'manual', 'import: pre_implementation_standards.csv'
from (values
  ('iasb-risk-mitigation-accounting-ifrs-9-ifrs-7-0d7e', 'exposure_draft', 'Comments due (extended)', '2026-11-30', null, 'Comment deadline was extended to this date.'),
  ('iasb-ifrs-18-amendments-maintenance-9872', 'implementation', 'IFRS 18 effective (verify)', '2027-01-01', null, 'From the spreadsheet: IFRS 18 effective 1 Jan 2027 (verify). The Dec 2026 exposure draft date does not change it.'),
  ('iasb-ifrs-9-hedge-accounting-post-implementat-f6b6', 'call_for_comments', 'Request for Information: comments close', '2027-01-26', null, null),
  ('iasb-ifrs-for-smes-narrow-scope-amendments-co-0f19', 'exposure_draft', 'Consultation closed', '2026-09-09', null, null),
  ('iasb-ifrs-for-smes-narrow-scope-amendments-co-0f19', 'implementation', 'Effective date', '2027-01-01', null, 'Aligned with IFRS for SMEs third edition.'),
  ('iaasb-isa-for-less-complex-entities-first-revi-eb1f', 'exposure_draft', 'Exposure draft', '2026-07-22', '2026-11-17', null),
  ('iaasb-isre-2410-revised-interim-financial-info-7919', 'exposure_draft', 'Comments closed', '2026-09-03', null, null),
  ('iesba-sustainability-reporting-and-assurance-i-3703', 'implementation', 'Effective for periods beginning on or after', '2026-12-15', null, 'Value-chain provisions: Jul 2028.'),
  ('ipsasb-ed-94-linkages-with-gfs-manual-2014-amen-599e', 'exposure_draft', 'Comments closed', '2026-06-22', null, null),
  ('ipsasb-ed-95-improvements-to-ipsas-vol-10-673f', 'exposure_draft', 'Comments closed', '2026-06-30', null, null),
  ('ipsasb-ed-96-definition-of-an-operation-and-acq-f7b0', 'exposure_draft', 'Comments closed', '2026-06-30', null, null),
  ('ipsasb-work-program-consultation-b783', 'call_for_comments', 'Consultation closed', '2026-05-04', null, null),
  ('issb-enhancing-sasb-standards-phase-1-nine-st-a63a', 'exposure_draft', 'Comments closed', '2025-11-30', null, null),
  ('issb-enhancing-sasb-standards-remaining-three-8665', 'exposure_draft', 'Comments closed', '2026-07-24', null, null),
  ('issb-ifrs-s2-ghg-emissions-amendments-cca9', 'implementation', 'Effective for periods beginning on or after', '2027-01-01', null, null)
) as v(project_id, type, title, start_date, end_date, notes)
where exists (select 1 from public.std_projects p where p.id = v.project_id)
on conflict do nothing;

-- check: how many of the imported projects and dates are in the tracker now (expected 38 and 15)
select (select count(*) from public.std_projects where created_by like 'import:%') as projects,
       (select count(*) from public.std_events where created_by like 'import:%') as dates;
