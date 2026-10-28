المتابعة غير مكتملة بعد: يلزم مخطط قاعدة البيانات وملفات RPC الحالية وربط الهوية بـSupabase Auth قبل تفعيل القواعد على التكليفات الفعلية. أكد المستخدم أنه سيحدد الفرع أو المسار. لم تُنشأ بنية تطبيق بديلة، ولم يُطبّق شيء على قاعدة مشتركة أو إنتاجية.

العمل مستمر داخل `C:/Users/Dalal/OneDrive/Desktop/Hawkim/.worktrees/frontend-ui-enhancements` على الفرع `feat/frontend-ui-enhancements`، مع حفظ تغييرات الواجهة السابقة وترك الدمج غير المكتمل في `develop` وتعديل package-lock والأرشيفات دون مساس. لم يحدث commit أو push أو merge أو staging.

الفحص وجد أن `20261026150000_internal_review.sql` غير موجود في الـcheckout أو تاريخ الفروع المحلية أو الأرشيفات المتاحة. عميل Supabase غير موصول بالشاشات، وتسجيل الدخول والمستخدمون والأقسام وSOPs ما زالت بيانات تجريبية. لا توجد جداول أو RLS أو RPC تكليف موثوقة يمكن تعديلها بأمان. معرف المستخدم الحالي التجريبي ليس بديلًا عن `auth.uid()`.

أُنجزت الأجزاء المستقلة التالية:

- Migration جديد `20261029000000_review_deadline_helpers.sql` يضيف دوال حساب والتحقق فقط؛ لا ينشئ تكليفًا ولا يحدّث سجلًا قديمًا ولا يغيّر إجراء فريق آخر.
- `hawkim_review_due_at(accepted_at, duration)` يحسب المدة من تاريخ القبول بتوقيت الرياض؛ يستبعد يوم القبول ويعدّ التواريخ اللاحقة الأحد إلى الخميس فقط. النطاق 1–30 يوم عمل.
- `hawkim_review_response_due_at(requested_at)` يحسب مهلة استجابة ثابتة مستقلة: ثاني يوم عمل بعد تاريخ الطلب في الرياض. لا تعتمد على قبول المراجع ولا على مدة مراجعته.
- نهاية المهلة `23:59:59.999` بتوقيت `Asia/Riyadh`، وتُعاد كـtimestamptz دقيق. لا تعتمد النتيجة على timezone جلسة قاعدة البيانات أو المتصفح، ولا يُستخدم offset ثابت بدل المنطقة الزمنية.
- دالة منفصلة تحفظ سياسة بدء احتساب الاستجابة 08:00 وcutoff 16:00؛ عند الإرسال خارج ساعات العمل تنتقل البداية إلى صباح يوم العمل المناسب. هذا لا يغيّر آخر تاريخ للمهلة الثابتة ولا يمنع القبول قبل الساعة الثامنة.
- دوال تحقق SQL تقبل تعليقًا اختياريًا حتى 1000 وحدة UTF-16 بعد trim، وترفض 1001. تحقق العنوان يفرض نصًا غير فارغ وحدًا خامًا 50 وحدة قبل trim، مطابقًا للنموذج، ثم يعيد القيمة المنظفة. لا تتغير حدود أسباب الرفض والإزالة أو النصوص الأخرى.
- حد المحرر والانتقالات الحالية للإرسال والإضافة وإعادة الإرسال أصبح 1000، مع العداد والتحقق قبل التعديل. أُضيف تحقق العنوان إلى استدعاء `SopsProvider.addDraft` مباشرة، وليس للنموذج فقط.

أمثلة SQL التي اختُبرت فعليًا:

| وقت القبول المحلي | مدة المراجعة | آخر يوم |
| --- | --- | --- |
| الأحد 25 أكتوبر 2026 | 2 | الثلاثاء 27 أكتوبر |
| الخميس 29 أكتوبر 2026 | 2 | الاثنين 2 نوفمبر |
| الخميس 29 أكتوبر 2026 | 3 | الثلاثاء 3 نوفمبر |
| الجمعة 30 أكتوبر 2026 | 1 | الأحد 1 نوفمبر |
| الاثنين 26 أكتوبر 2026 | 5 | الاثنين 2 نوفمبر |

الجمعة والسبت مستبعدان في الدوال الجديدة. اختُبرت مدد 1 و2 و3 و5 و10 عبر كل أيام القبول، بما فيها نهاية الأسبوع وحدود الشهر والسنة والسنة الكبيسة. لا يوجد تقويم عطلات رسمية؛ لم يُختلق واحد.

نتائج التحقق:

| الفحص | النتيجة |
| --- | --- |
| تحميل Migration في PostgreSQL 17 محلي معزول | ناجح |
| اختبارات SQL للتقويم والحدود والتوقيت ومنح التنفيذ | ناجحة، بما فيها تنفيذ authenticated وservice_role ورفض anon |
| مطابقة معاينة الرد مع PostgreSQL الفعلي | 3006 حالات ناجحة عبر حدود الأيام والسنة والسنة الكبيسة |
| `npm test` | 587 اختبارًا ناجحًا في 44 ملفًا |
| `npm run lint` | ناجح دون تحذيرات |
| `npm run build` | ناجح ويشمل TypeScript ثم Vite |
| `git diff --check` | ناجح |

اختبار منح تنفيذ الدوال ليس اختبار صلاحية تعديل تكليف. ودوال التحقق لا تثبت حفظ تعليق في جدول حقيقي. لذلك لا أؤكد بعد عمل تعليقات 1000 حرف end to end داخل Supabase، ولا أؤكد إنفاذ مواعيد أيام العمل على التكليفات القائمة.

الجزء المتبقي بعد استلام المخطط:

- ربط حساب المواعيد بـRPC الإرسال والقبول باستخدام وقت الخادم الموثوق، وإرجاع timestamps رسمية للواجهة. الحساب الحالي لقبول المراجعة في النسخة التجريبية ما زال أيامًا تقويمية/نهاية يوم محلية؛ لم يُخفَ هذا القيد بنص واجهة يوحي بعكسه.
- فرض هوية Auth وملكية Author وأهلية المراجع ومنع Author وCo-Authors ومقاومة التكليفات الملغاة أو القديمة داخل معاملات قاعدة البيانات.
- مراجعة قيود التعليقات والعنوان الفعلية ورفع حد التعليق إلى 1000 في RPCs والقيود معًا؛ التحقق عند تحديث العنوان يحتاج كذلك مسار التحديث الحقيقي.
- ربط الخدمات وProviders والمواعيد والتنبيهات ببيانات قاعدة البيانات، وتحويل handlers ذات الصلة إلى عمليات منتظرة حتى لا تُعلن الواجهة نجاحًا قبل استجابة RPC.
- مراجعة سجلات Department وDivision الحقيقية. يبقى divisionId في النموذج الحالي مفتاح تجميع، وليس قائمة subdivisions، ولم تُخترع بنية بديلة أو routing خارجي.
- تحديد تحويل السجلات النشطة بعد فحص المخطط: حساب المقترحات من requestedAt/acceptedAt الأصليين مع معاينة الفرق وتسجيل before/after، وعدم إعادة حساب القرارات المكتملة أو الجولات التاريخية. الـMigration الحالي لا يعيد حساب أي سجل، ولا يمكن كتابة backfill آمن بأسماء جداول وعلاقات غير معروفة.
- تشغيل اختبارات RPC للصلاحيات والإرسال والقبول والرفض والإكمال والموافقة والحفظ الفعلي قبل اعتبار المهمة مكتملة. لا يُطبّق أي تغيير على مشروع مشترك دون موافقة المستخدم.

جميع ملفات الـworktree الحالية، بما فيها دفعة الواجهة السابقة، موضحة أدناه. الحالة `معدل` لملف متتبع تغيّر، و`جديد` لملف غير متتبع بعد:

| الملف | الحالة | الغرض |
| --- | --- | --- |
| `docs/backend-integration-status.ar.md` | جديد | تقرير تقدم عربي يوضح العائق والنتائج وجميع الملفات الحالية. |
| `docs/frontend-ui-integration.md` | جديد | تحديث حالة حد التعليقات وبيان أن ربط SQL بالـRPC لا يزال متعذرًا لغياب المخطط. |
| `docs/frontend-ui-report.ar.md` | جديد | توضيح أنه تقرير الدفعة السابقة مع الإحالة إلى الحالة الحالية. |
| `frontend/src/components/admin/blockerMessages.ts` | معدل | تعريف SOP بعنوانه في أسباب منع التعديلات الإدارية. |
| `frontend/src/components/layout/NotificationsBell.tsx` | معدل | عرض عنوان SOP في نص الإشعار. |
| `frontend/src/components/mySops/AuthoredSopGrid.tsx` | جديد | بطاقات SOP بنفس معلومات القائمة ونمط التصميم. |
| `frontend/src/components/mySops/AuthoredSopList.tsx` | معدل | الشارتان وإخفاء serial من العرض والتسمية الميسّرة. |
| `frontend/src/components/reviews/ReviewTaskList.tsx` | جديد | بطاقات وقائمة المهام والمواعيد والحالات الحقيقية. |
| `frontend/src/components/sops/SopGrid.tsx` | معدل | إخفاء serial من بطاقات الدليل والتسميات الميسرة. |
| `frontend/src/components/sops/SopList.tsx` | معدل | حذف عمود serial ونصه من العرضين المكتبي والمحمول. |
| `frontend/src/components/ui/Card.tsx` | معدل | دعم actions في الرأس مع إبقاء بنية البطاقات الافتراضية كما كانت. |
| `frontend/src/components/workflow/InternalReviewPanel.tsx` | معدل | رأس الأفعال والعرض قبل الجولة الأولى وإظهار مراجعي التدفقات القديمة. |
| `frontend/src/components/workflow/ReviewRequestDetails.tsx` | معدل | تمرير inactive لإيقاف مؤشرات النشاط للمهام التاريخية. |
| `frontend/src/components/workflow/ReviewerDeadline.tsx` | معدل | منع countdown وOverdue المضلل عند عرض مهمة تاريخية مغلقة. |
| `frontend/src/components/workflow/SubmitDialog.tsx` | معدل | PeoplePicker وحقول القسم والمهلة الثابتة ومسودة التعليقات والتحقق. |
| `frontend/src/components/workflow/VersionHistory.tsx` | معدل | أسماء تنزيل إصدارات مبنية على عنوان SOP. |
| `frontend/src/components/workflow/approvalInterface.test.tsx` | معدل | حصر تحقق Workflow Status داخل قسمه بعد نقل Reviewers. |
| `frontend/src/components/workflow/internalReviewInterface.test.tsx` | معدل | تحديث التوقعات للقائمة القابلة للبحث والمهلة الثابتة وAdd Reviewers. |
| `frontend/src/components/workflow/reviewFlowInterface.test.tsx` | معدل | تحديث تحقق النافذة مع إبقاء اختبارات المهلات الأخرى. |
| `frontend/src/components/workflow/reviewRequestsCard.test.tsx` | معدل | استخدام عنوان Reviewers من content في التوقع القائم. |
| `frontend/src/components/workflow/reviewerDeadlines.test.tsx` | معدل | تحديث توقع حد تعليق Resubmit إلى 1000 مع بقاء حسابات المواعيد السابقة. |
| `frontend/src/components/workflow/submitDialog.test.tsx` | جديد | اختبار واجهة التعليقات ذات حد 1000 والنص الجديد دون الادعاء بالحفظ في Supabase. |
| `frontend/src/content/admin.en.ts` | معدل | قالب سبب المنع يستخدم عنوان SOP. |
| `frontend/src/content/compliance.en.ts` | معدل | قوالب عنوان التقرير والطباعة والرجوع. |
| `frontend/src/content/internalReview.en.ts` | معدل | نصوص الواجهة السابقة ونص حد التعليقات الجديد 1000. |
| `frontend/src/content/landing.en.ts` | معدل | إزالة serial من مثال نشاط ظاهر بصفحة التعريف. |
| `frontend/src/content/mySops.en.ts` | معدل | نصوص الدور والفئات والبحث والمرشحات وحد العنوان والحالة الفارغة. |
| `frontend/src/content/notifications.en.ts` | معدل | استبدال code بعنوان SOP في جميع قوالب التنبيهات. |
| `frontend/src/content/reviews.en.ts` | معدل | نصوص مجموعات المراجعة وApprovals والقالب المعتمد على العنوان. |
| `frontend/src/content/sops.en.ts` | معدل | نص البحث والقوالب المعتمدة على عنوان SOP. |
| `frontend/src/content/types.ts` | معدل | أنواع نصوص الواجهة والتلميحات الجديدة ووصف placeholders. |
| `frontend/src/content/workflow.en.ts` | معدل | Add Reviewers وقوالب عناوين SOP والمعاينة مع حفظ الإصدار. |
| `frontend/src/data/mock/dashboard.ts` | معدل | إزالة serial من رسالة نشاط تجريبية ظاهرة للمستخدم. |
| `frontend/src/lib/fixedResponseDeadline.test.ts` | جديد | اختبار عطلة الأسبوع وتغيّر السنة وحدود منتصف الليل والوقت غير الصالح. |
| `frontend/src/lib/fixedResponseDeadline.ts` | جديد | حساب تاريخ يومَي العمل بتوقيت الرياض دون تعديل المهلات المحفوظة. |
| `frontend/src/lib/internalReview.test.ts` | معدل | اختبار التعليقات في الإرسال والإضافة والإصدار الجديد مع حفظ التاريخ. |
| `frontend/src/lib/internalReview.ts` | معدل | تطبيق الحد المشترك 1000 على إرسال المراجعة الداخلية وإضافة المراجعين والإصدار الجديد. |
| `frontend/src/lib/mySops.test.ts` | جديد | اختبار الفئات والبحث والمرشحات والتكامل والعزل. |
| `frontend/src/lib/mySops.ts` | جديد | نطاق الملكية وتصفيات العرض دون تعديل البيانات. |
| `frontend/src/lib/notifications.ts` | معدل | إضافة sopTitle لمعلومات العرض دون تغيير هوية الإشعار أو قواعد إصداره. |
| `frontend/src/lib/reviewFlow.test.ts` | معدل | اختبارات حد تعليق الإرسال في مسار reviewFlow القديم. |
| `frontend/src/lib/reviewFlow.ts` | معدل | رفع حد تعليق الإرسال في المسار القديم دون تعديل قرارات المراجعين أو الصلاحيات. |
| `frontend/src/lib/reviewSubmission.test.ts` | جديد | اختبار قبول 500 و501 و1000 ورفض 1001 والتحقق السابق للنموذج. |
| `frontend/src/lib/reviewSubmission.ts` | جديد | توحيد حد المحرر والتحقق مع حد الانتقالات 1000. |
| `frontend/src/lib/reviews.test.ts` | معدل | اختبار التجميع وحفظ الطابور والتاريخ وعدم تكرار SOP. |
| `frontend/src/lib/reviews.ts` | معدل | تجميع عرض المراجع ومنع عرض تكليف تاريخي كنشط وإتاحة بيانات موعد المراجع القديم. |
| `frontend/src/lib/sopPresentation.ts` | جديد | أسماء تنزيل مبنية على العنوان وإخفاء serial من اسم الملف المعروض. |
| `frontend/src/lib/sopTitle.ts` | جديد | تحقق عنوان مشترك للنموذج واستدعاء إنشاء SOP مباشرة. |
| `frontend/src/lib/workflow.test.ts` | معدل | تغطية حد التعليقات عبر الإرسال وإعادة الإرسال القديمين وعدم التعديل عند الرفض. |
| `frontend/src/lib/workflow.ts` | معدل | حد تعليقات الإرسال وإعادة الإرسال 1000 والتحقق قبل تغيير البيانات. |
| `frontend/src/pages/ComplianceReportPage.tsx` | معدل | استبدال serial في العنوان والرجوع وبيانات التقرير والطباعة. |
| `frontend/src/pages/MySopsPage.test.tsx` | جديد | اختبار العرض والدور والتفضيل والعزل وعدم ظهور serial. |
| `frontend/src/pages/MySopsPage.tsx` | معدل | البحث والمرشحات والفئات وتفضيل العرض مع الحفاظ على نطاق القسم والملكية. |
| `frontend/src/pages/ReviewPage.tsx` | معدل | استخدام عنوان SOP في الرأس والمعاينة والنشر والتنزيل مع بقاء حماية الإصدار. |
| `frontend/src/pages/ReviewsPage.tsx` | معدل | تبويبات المراجعين ومنطقة Approvals وتفضيل عرض مستقل. |
| `frontend/src/pages/SopDetailPage.tsx` | معدل | إزالة serial من صفحة الدليل والمعاينة والتنزيل. |
| `frontend/src/pages/SopWorkflowPage.tsx` | معدل | ترتيب الأقسام ونقل الأزرار واستبدال serial في العناوين والمعاينة. |
| `frontend/src/pages/UploadSopPage.tsx` | معدل | required وحد 50 حرفًا والتحقق عند الإرسال. |
| `frontend/src/pages/admin/UserDetailsPage.tsx` | معدل | إخفاء serial من قائمة مشاركة المستخدم في SOPs. |
| `frontend/src/pages/reviewsUi.test.tsx` | جديد | اختبار العرض والصلاحيات والمواعيد والتفضيل وApprovals والتاريخ. |
| `frontend/src/pages/sopPresentation.test.tsx` | جديد | اختبار العناوين والتنزيل والتنبيهات وترتيب الأقسام والأزرار وقيود العنوان. |
| `frontend/src/state/SopsProvider.tsx` | معدل | فرض العنوان الإلزامي وحد 50 قبل إنشاء المسودة، وحفظ العنوان بعد trim. |
| `frontend/src/state/directoryAccessPermissions.test.tsx` | معدل | اختبار عنوان الإنشاء المباشر مع الإبقاء على اختبارات عزل الأقسام والصلاحيات. |
| `supabase/migrations/20261029000000_review_deadline_helpers.sql` | جديد | Migration إضافي لدوال حساب أيام العمل والتحقق فقط؛ لا يرتبط بعد بأي جدول أو RPC تكليف. |
| `supabase/tests/calendar_helpers.sql` | جديد | اختبارات PostgreSQL فعلية للتقويم والمواعيد والحدود والمنح ومنع التنفيذ المجهول. |
| `supabase/tests/calendar_parity.mjs` | جديد | مطابقة 3006 نتيجة فعلية من PostgreSQL مع تاريخ معاينة الرد في الواجهة. |

حالة Git الحالية: 46 ملفًا معدلًا و20 ملفًا جديدًا، جميعها غير staged، على `feat/frontend-ui-enhancements`. مجلد `develop` الأصلي ما زال في merge غير مكتمل كما كان. هذا تقرير تقدم وعائق تكامل، وليس إعلان اكتمال للمهمة.

