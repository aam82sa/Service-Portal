-- Demo correspondence: 10 letters with full information for testing the
-- Phase A archive. Skips itself entirely if the demo letters already exist.
-- Files are not seeded (uploads happen through the UI); everything else —
-- references, bilingual briefs, OCR text, shares, comments, audit events —
-- is populated. Reference counters are bumped so future issued numbers
-- continue after the seeded ones.

do $$
declare
  v_afnan uuid := '44444444-4444-4444-8444-444444444411'; -- Admin officer
  v_hatem uuid := '44444444-4444-4444-8444-444444444403'; -- Admin dept head
  v_lama  uuid := '44444444-4444-4444-8444-444444444407'; -- Admin team lead
  v_layla uuid := '44444444-4444-4444-8444-444444444406'; -- IT team lead
  v_loay  uuid := '44444444-4444-4444-8444-444444444408'; -- Procurement team lead
  v_basma uuid := '44444444-4444-4444-8444-444444444414'; -- business requester
  v_scheme uuid;
  v_a int; v_i int; v_p int;
begin
  if exists (select 1 from letters where id = '55555555-5555-4555-8555-555555555501') then
    raise notice 'demo letters already seeded — nothing to do';
    return;
  end if;

  -- references continue from wherever the numbering engine currently stands,
  -- so the seed never collides with numbers that were already issued
  select id into v_scheme from numbering_schemes where is_default limit 1;
  select coalesce(max(value), 0) into v_a from numbering_counters where scheme_id = v_scheme and scope_key = 'ADMIN' and period_key = '2026';
  select coalesce(max(value), 0) into v_i from numbering_counters where scheme_id = v_scheme and scope_key = 'IT' and period_key = '2026';
  select coalesce(max(value), 0) into v_p from numbering_counters where scheme_id = v_scheme and scope_key = 'PROC' and period_key = '2026';

  insert into letters (id, direction, ref_ours, ref_theirs, letter_date, received_on,
                       sender, addressee, subject, brief_ar, brief_en, ocr_text,
                       confidentiality, dept, owner_id, status, created_by) values

  ('55555555-5555-4555-8555-555555555501', 'incoming', 'ADMIN/2026/' || lpad((v_a + 1)::text, 4, '0'), 'RM-8841/47',
   '2026-07-01', '2026-07-02', 'Riyadh Municipality', 'ABC Corp — Administration',
   'إشعار رسوم البلدية للمقر الرئيسي — الربع الثالث',
   'إشعار من بلدية الرياض بخصوص رسوم المقر الرئيسي للربع الثالث من عام ٢٠٢٦، ويطلب السداد خلال ثلاثين يوماً من تاريخ الإشعار مع إرفاق إيصال السداد.',
   'Notice from Riyadh Municipality for Q3 2026 municipal fees on the HQ premises; payment is requested within 30 days with proof of payment to be returned.',
   'بلدية مدينة الرياض — إدارة الإيرادات. إشارة إلى رخصة البلدية رقم ٤٤١٢٣، نفيدكم باستحقاق رسوم الربع الثالث لعام ٢٠٢٦ عن المقر الرئيسي الكائن بحي العليا. يرجى السداد خلال ثلاثين يوماً.',
   'general', 'ADMIN', v_afnan, 'in_review', v_afnan),

  ('55555555-5555-4555-8555-555555555502', 'outgoing', 'ADMIN/2026/' || lpad((v_a + 2)::text, 4, '0'), null,
   '2026-07-03', '2026-07-03', 'ABC Corp — Administration', 'Riyadh Municipality — Revenue Dept',
   'Reply — municipal fee notice RM-8841/47 (HQ premises)',
   'رد على إشعار الرسوم؛ تم اعتماد السداد وسيتم التحويل خلال أسبوع مع موافاتكم بإيصال السداد.',
   'Acknowledges notice RM-8841/47; payment has been approved and will be transferred within a week, with the receipt to follow.',
   'With reference to your notice RM-8841/47 dated 01 July 2026, we confirm the fee payment has been approved and will be settled within seven working days.',
   'general', 'ADMIN', v_afnan, 'answered', v_afnan),

  ('55555555-5555-4555-8555-555555555503', 'incoming', 'ADMIN/2026/' || lpad((v_a + 3)::text, 4, '0'), 'MHRSD-2026-55112',
   '2026-06-28', '2026-06-30', 'Ministry of Human Resources and Social Development', 'ABC Corp — HR / Administration',
   'خطاب متابعة نسب التوطين — نطاقات',
   'خطاب من وزارة الموارد البشرية بشأن متابعة نسب التوطين في برنامج نطاقات، ويطلب تحديث بيانات الموظفين في منصة قوى خلال أسبوعين.',
   'Letter from MHRSD following up Saudization (Nitaqat) ratios; employee data must be updated on the Qiwa platform within two weeks.',
   'وزارة الموارد البشرية والتنمية الاجتماعية. بالإشارة إلى برنامج نطاقات، نأمل تحديث بيانات منشأتكم عبر منصة قوى خلال مدة أقصاها أسبوعان من تاريخه.',
   'restricted', 'ADMIN', v_hatem, 'in_review', v_hatem),

  ('55555555-5555-4555-8555-555555555504', 'incoming', 'ADMIN/2026/' || lpad((v_a + 4)::text, 4, '0'), 'ZATCA/AUD/2026/9017',
   '2026-06-25', '2026-06-26', 'Zakat, Tax and Customs Authority', 'ABC Corp — Finance / Administration',
   'إشعار فحص ميداني — ضريبة القيمة المضافة',
   'إشعار من هيئة الزكاة والضريبة والجمارك بفحص ميداني لسجلات ضريبة القيمة المضافة للسنة المالية ٢٠٢٥، مع تحديد موعد الزيارة وقائمة المستندات المطلوبة.',
   'ZATCA notifies a VAT field audit for fiscal year 2025, specifying the visit date and the list of required records.',
   'هيئة الزكاة والضريبة والجمارك — قطاع الفحص. نفيدكم بأنه تقرر إجراء فحص ميداني لسجلات ضريبة القيمة المضافة لمنشأتكم عن السنة المالية ٢٠٢٥.',
   'restricted', 'ADMIN', v_hatem, 'registered', v_afnan),

  ('55555555-5555-4555-8555-555555555505', 'outgoing', 'ADMIN/2026/' || lpad((v_a + 5)::text, 4, '0'), null,
   '2026-07-05', '2026-07-05', 'ABC Corp — Administration', 'Al-Faisaliah Real Estate Co.',
   'HQ lease renewal — proposed terms for 2027–2029',
   'خطاب إلى المؤجر بشأن تجديد عقد إيجار المقر الرئيسي للفترة ٢٠٢٧–٢٠٢٩ مع الشروط المقترحة.',
   'Letter to the landlord proposing renewal terms for the HQ lease covering 2027–2029, including a two-year fixed rate option.',
   'Dear Sirs, further to our meeting of 28 June, we set out below our proposed terms for renewing the head-office lease for the period 2027-2029...',
   'general', 'ADMIN', v_lama, 'in_review', v_lama),

  ('55555555-5555-4555-8555-555555555506', 'incoming', null, 'CoC-RY-2026-3345',
   '2026-07-06', '2026-07-07', 'Riyadh Chamber of Commerce', 'ABC Corp',
   'تجديد عضوية الغرفة التجارية لعام ٢٠٢٧',
   'إشعار بقرب انتهاء عضوية الغرفة التجارية ودعوة للتجديد قبل نهاية الشهر للاستفادة من الخصم المبكر.',
   'Chamber of Commerce membership renewal notice for 2027; early-renewal discount applies until month end.',
   'غرفة الرياض — إدارة العضويات. نفيدكم بقرب انتهاء عضوية منشأتكم، ونأمل المبادرة بالتجديد للاستفادة من خصم التجديد المبكر.',
   'general', 'ADMIN', v_afnan, 'registered', v_afnan),

  ('55555555-5555-4555-8555-555555555507', 'incoming', 'ADMIN/2026/' || lpad((v_a + 6)::text, 4, '0'), 'LC-2026-081',
   '2026-06-20', '2026-06-21', 'External legal counsel', 'ABC Corp — Administration (owner only)',
   'Settlement proposal — warehouse lease dispute',
   'اقتراح تسوية من المستشار القانوني بخصوص نزاع عقد إيجار المستودع، يتضمن مبلغ التسوية المقترح وشروط الإنهاء.',
   'Settlement proposal from external counsel for the warehouse lease dispute, including the proposed settlement amount and termination terms.',
   'PRIVILEGED AND CONFIDENTIAL. Following our review of the lease dispute, we recommend a negotiated settlement on the following terms...',
   'confidential', 'ADMIN', v_afnan, 'in_review', v_afnan),

  ('55555555-5555-4555-8555-555555555508', 'outgoing', 'IT/2026/' || lpad((v_i + 1)::text, 4, '0'), null,
   '2026-07-04', '2026-07-04', 'ABC Corp — IT Services', 'Alfalak Electronic Equipment',
   'Warranty claim — ThinkPad X1 batch (PO 57)',
   'مطالبة ضمان لدفعة أجهزة ThinkPad X1 الموردة بأمر الشراء رقم ٥٧ بسبب أعطال متكررة في الشاشات.',
   'Warranty claim for the ThinkPad X1 batch supplied under PO 57, citing recurring display failures on three units.',
   'Reference PO 57 and delivery note DN-1182: three units (serials PF591NX, PF59X58Z, PF5931NX) exhibit recurring display failures and are submitted for warranty service.',
   'general', 'IT', v_layla, 'in_review', v_layla),

  ('55555555-5555-4555-8555-555555555509', 'incoming', 'PROC/2026/' || lpad((v_p + 1)::text, 4, '0'), 'ALN-PL-2026-07',
   '2026-07-02', '2026-07-03', 'Alnafitha IT', 'ABC Corp — Procurement',
   'Updated price list and renewal quotations — H2 2026',
   'قائمة الأسعار المحدثة وعروض التجديد للنصف الثاني من ٢٠٢٦ من شركة النفيثة لتقنية المعلومات.',
   'Updated H2 2026 price list and renewal quotations from Alnafitha IT covering Microsoft licensing tiers.',
   'Please find attached our updated price list effective 01 July 2026, together with renewal quotations for your Microsoft 365 and Intune estate.',
   'general', 'PROC', v_loay, 'registered', v_loay),

  ('55555555-5555-4555-8555-555555555510', 'outgoing', 'ADMIN/2026/' || lpad((v_a + 7)::text, 4, '0'), null,
   '2026-07-07', '2026-07-07', 'ABC Corp — Administration', 'General Organization for Social Insurance',
   'طلب تأكيد تسجيل موظفين جدد — التأمينات الاجتماعية',
   'طلب إلى التأمينات الاجتماعية لتأكيد اكتمال تسجيل خمسة موظفين جدد وتحديث الأجور الخاضعة للاشتراك.',
   'Request to GOSI to confirm completion of registration for five new employees and the update of contributory wages.',
   'إلى المؤسسة العامة للتأمينات الاجتماعية. نأمل تأكيد اكتمال تسجيل الموظفين الجدد المشار إليهم أدناه وتحديث الأجور الخاضعة للاشتراك.',
   'general', 'ADMIN', v_afnan, 'answered', v_afnan);

  -- future issued numbers continue after the seeded ones
  if v_scheme is not null then
    insert into numbering_counters (scheme_id, scope_key, period_key, value) values
      (v_scheme, 'ADMIN', '2026', v_a + 7),
      (v_scheme, 'IT',    '2026', v_i + 1),
      (v_scheme, 'PROC',  '2026', v_p + 1)
    on conflict (scheme_id, scope_key, period_key)
      do update set value = greatest(numbering_counters.value, excluded.value);
  end if;

  -- shares: the municipality letter with Basma; the lease letter with Procurement
  insert into letter_shares (letter_id, user_id, shared_by) values
    ('55555555-5555-4555-8555-555555555501', v_basma, v_afnan);
  insert into letter_shares (letter_id, dept, shared_by) values
    ('55555555-5555-4555-8555-555555555505', 'PROC', v_lama);

  -- a lived-in audit trail (register events were logged by the insert trigger)
  insert into letter_events (letter_id, actor_id, event_type, detail) values
    ('55555555-5555-4555-8555-555555555501', v_hatem, 'viewed',  '{"file":"municipality-notice.pdf"}'),
    ('55555555-5555-4555-8555-555555555501', v_hatem, 'comment', '{"body":"Please schedule payment before month end and file the receipt here."}'),
    ('55555555-5555-4555-8555-555555555501', v_afnan, 'comment', '{"body":"Payment request sent to Finance — awaiting transfer confirmation."}'),
    ('55555555-5555-4555-8555-555555555503', v_hatem, 'comment', '{"body":"HR to update Qiwa data — deadline 14 July."}'),
    ('55555555-5555-4555-8555-555555555504', v_hatem, 'viewed',  '{"file":"zatca-audit-notice.pdf"}'),
    ('55555555-5555-4555-8555-555555555508', v_layla, 'comment', '{"body":"Vendor RMA numbers received; devices ship Sunday."}');

  raise notice 'seeded 10 demo letters';
end $$;
