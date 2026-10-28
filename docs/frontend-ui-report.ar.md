هذا تقرير تسليم مرحلة الواجهة السابقة. المتابعة الحالية لإضافة Backend موثقة في `docs/backend-integration-status.ar.md`؛ تغير حد التعليقات في الانتقالات الحالية إلى 1000، لكن التكامل الفعلي مع Supabase ينتظر مخطط قاعدة البيانات. الأرقام والقيود أدناه تصف مرحلة التسليم السابقة.

تم تنفيذ تحسينات الواجهة القابلة للتطبيق على الفرع `feat/frontend-ui-enhancements`، انطلاقًا من `develop` عند `5fda6cc`، داخل worktree معزول:

`C:/Users/Dalal/OneDrive/Desktop/Hawkim/.worktrees/frontend-ui-enhancements`

تعذّر تبديل فرع مجلد العمل الأصلي لوجود merge غير مكتمل على `develop`. لذلك بقي ذلك المجلد ودمجه وتعديل `frontend/package-lock.json` والأرشيفات الأصلية دون تغيير. لم تُنشأ commits، ولم يُنفَّذ push أو merge أو staging.

أصبحت My SOPs تعرض شارتَي Main Author وCo-Author في القائمتين، وتصنّف الحالات الحالية إلى New SOPs وIn Progress وCompleted دون تغيير قيم الحالات. تتكامل تصفية الاسم وتاريخ آخر تحديث والدور مع البحث المباشر بالعنوان. أُضيف عرض البطاقات وحفظ تفضيل العرض بمفتاح `hawkim.my-sops.view` مع حالات فارغة وإعادة ضبط المرشحات. تبقى Approved مميزة عن Published بالشارة الأصلية، ويظل النطاق ملكية المستخدم داخل قسمه الأصلي.

أصبحت My Reviews تستخدم مسار `/reviews` نفسه، وتعرض Incoming Requests وActive Reviews وCompleted Reviews مع حالات الإغلاق الحقيقية. بقيت مهام Approver في منطقة Approvals مستقلة داخل الصفحة نفسها. يُحفظ تفضيل العرض بمفتاح `hawkim.reviews.view`. بقيت قوائم الانتظار القديمة قابلة للوصول، وتوقفت مؤقتات العرض التاريخي عن ادعاء أن الطلب السابق ما زال نشطًا.

نُقلت أزرار المراجعة والرد وSubmit for Approval إلى رأس Reviewers، مع الحفاظ على handlers والحماية والتلميحات والحالات المعطّلة، وأصبح زر بدء المراجعة ظاهرًا حتى قبل وجود جولة. الترتيب هو Authors ثم SOP History ثم Compliance Check ثم Reviewers ثم Review Timeline، مع الإبقاء على Workflow Status. بقيت أوضاع الإرسال الأول وإضافة مراجعين وإرسال إصدار جديد مستقلة. أُزيل عرض serial المولّد من الصفحات والبطاقات والتنبيهات والعناوين وأسماء التنزيل التي تتحكم بها الواجهة، مع إبقاء الهوية الداخلية والسجلات ومحتوى المستندات. بقي عنوان المعاينة وإصدارها ظاهرين.

تستخدم Submit for Review مكوّن PeoplePicker القائم للبحث بالاسم والاختيار المتعدد والحذف والتنقل بلوحة المفاتيح. تُستبعد الحسابات غير المؤهلة وAuthor وCo-Authors كما في القواعد الحالية. يظهر القسم وdivisionId المُعدّ للقسم للقراءة فقط، ولا توجد اختيارات خارجية أو أسماء Divisions مختلقة. يُرسَل تاريخ استجابة محسوب فعليًا، وتبقى مدة المراجعة وتعليقات الإرسال مدققتين قبل استدعاء الانتقال القائم.

كان التحقق من العنوان الإلزامي موجودًا، وكذلك فصل إجراءات المراجعة وحماية المشاركين وإظهار الوصف. لكن الفحص الفعلي وجد حد عنوان 150 حرفًا وترتيب أقسام مختلفًا؛ صُحّح حد الواجهة إلى 50 مع required وتحقق وقت الإرسال، وصُحّح الترتيب. لم تُعَد كتابة العناوين المحفوظة سابقًا أو منطق سير العمل.

تبقى القيود التالية معلنة، ولا يُدّعى اكتمال متطلبات الخدمة المرتبطة بها:

| المتطلب | المنفذ الآن | الاعتماد المتبقي |
| --- | --- | --- |
| مهلة رد يومَي عمل | ثاني تاريخ عمل بعد تاريخ الإرسال في Asia/Riyadh، دون احتساب يوم الإرسال أو الجمعة والسبت، ويُعاد الحساب عند التأكيد | فرض السياسة في الخدمة من وقت موثوق. انتهاء المهلة الحالي لا يزال 23:59:59.999 بتوقيت المتصفح المحلي؛ يلزم توحيد timestamp بتوقيت الرياض للسحب والتنبيهات. لا يوجد تقويم عطلات رسمية. |
| مدة مراجعة تستبعد عطلة الأسبوع | حقل اختياري 1–30 يومًا، يبدأ بعد قبول المراجع؛ النص يصرّح بأنه يحسب أيامًا تقويمية حاليًا | تحديث حساب المهلة عند القبول في الخدمة، دون إعادة حساب الجولات القديمة. |
| تعليقات 1000 حرف | مسودة محرر حتى 1000 مع عداد حي؛ الإرسال فوق 500 حرف بعد trim يُمنع برسالة ويبقى النص محفوظًا في النافذة | رفع حد التحقق المشترك وSQL/RPC معًا. ملف migration المذكور في الطلب غير موجود في هذا checkout، ولم تُعدّل قاعدة بيانات. |
| مراجعة أقسام أخرى وDivision قابل للاختيار | عرض القسم الأصلي وdivisionId القائم للقراءة فقط؛ اختيار المراجعين قابل للبحث | عقد routing وصلاحيات وتكليفات version-scoped للأقسام الخارجية، ومصدر بيانات متفق عليه للـDivisions. الحقلان المقفلان ليسا قائمتي بحث. |
| أسماء تنزيل عارض PDF الأصلي | روابط تنزيل التطبيق تستخدم عنوان SOP والإصدار | قد يستخدم عارض المتصفح الأصلي أو فتح URL مباشرة اسم الملف الأصلي؛ ضمان الاسم هناك يتطلب Content-Disposition أو عارضًا تتحكم به الواجهة. لم تُعدّل ملفات PDF. |

الملفات التالية هي جميع ملفات التسليم، بمساراتها النسبية من worktree. الحالة `معدل` تعني ملفًا متتبعًا تغيّر، و`جديد` تعني ملفًا غير متتبع بعد:

| الملف | الحالة | الغرض |
| --- | --- | --- |
| `frontend/src/pages/MySopsPage.tsx` | معدل | البحث والمرشحات والفئات وتفضيل العرض مع الحفاظ على نطاق القسم والملكية. |
| `frontend/src/components/mySops/AuthoredSopList.tsx` | معدل | الشارتان وإخفاء serial من العرض والتسمية الميسّرة. |
| `frontend/src/components/mySops/AuthoredSopGrid.tsx` | جديد | بطاقات SOP بنفس معلومات القائمة ونمط التصميم. |
| `frontend/src/lib/mySops.ts` | جديد | نطاق الملكية وتصفيات العرض دون تعديل البيانات. |
| `frontend/src/lib/mySops.test.ts` | جديد | اختبار الفئات والبحث والمرشحات والتكامل والعزل. |
| `frontend/src/pages/MySopsPage.test.tsx` | جديد | اختبار العرض والدور والتفضيل والعزل وعدم ظهور serial. |
| `frontend/src/pages/ReviewsPage.tsx` | معدل | تبويبات المراجعين ومنطقة Approvals وتفضيل عرض مستقل. |
| `frontend/src/components/reviews/ReviewTaskList.tsx` | جديد | بطاقات وقائمة المهام والمواعيد والحالات الحقيقية. |
| `frontend/src/lib/reviews.ts` | معدل | تجميع عرض المراجع ومنع عرض تكليف تاريخي كنشط وإتاحة بيانات موعد المراجع القديم. |
| `frontend/src/lib/reviews.test.ts` | معدل | اختبار التجميع وحفظ الطابور والتاريخ وعدم تكرار SOP. |
| `frontend/src/pages/reviewsUi.test.tsx` | جديد | اختبار العرض والصلاحيات والمواعيد والتفضيل وApprovals والتاريخ. |
| `frontend/src/components/workflow/ReviewRequestDetails.tsx` | معدل | تمرير inactive لإيقاف مؤشرات النشاط للمهام التاريخية. |
| `frontend/src/components/workflow/ReviewerDeadline.tsx` | معدل | منع countdown وOverdue المضلل عند عرض مهمة تاريخية مغلقة. |
| `frontend/src/pages/SopWorkflowPage.tsx` | معدل | ترتيب الأقسام ونقل الأزرار واستبدال serial في العناوين والمعاينة. |
| `frontend/src/components/workflow/InternalReviewPanel.tsx` | معدل | رأس الأفعال والعرض قبل الجولة الأولى وإظهار مراجعي التدفقات القديمة. |
| `frontend/src/components/ui/Card.tsx` | معدل | دعم actions في الرأس مع إبقاء بنية البطاقات الافتراضية كما كانت. |
| `frontend/src/components/workflow/SubmitDialog.tsx` | معدل | PeoplePicker وحقول القسم والمهلة الثابتة ومسودة التعليقات والتحقق. |
| `frontend/src/lib/fixedResponseDeadline.ts` | جديد | حساب تاريخ يومَي العمل بتوقيت الرياض دون تعديل المهلات المحفوظة. |
| `frontend/src/lib/fixedResponseDeadline.test.ts` | جديد | اختبار عطلة الأسبوع وتغيّر السنة وحدود منتصف الليل والوقت غير الصالح. |
| `frontend/src/lib/reviewSubmission.ts` | جديد | إعداد payload صالح والتحقق من المراجعين والمدة وحد الخدمة للتعليقات. |
| `frontend/src/lib/reviewSubmission.test.ts` | جديد | اختبار التكرار وعدم الأهلية والمدة والتعليقات وإعادة حساب المهلة. |
| `frontend/src/components/workflow/submitDialog.test.tsx` | جديد | اختبار نافذة الإرسال والحقول المقفلة والأهلية والعداد والمهلة. |
| `frontend/src/pages/UploadSopPage.tsx` | معدل | required وحد 50 حرفًا والتحقق عند الإرسال. |
| `frontend/src/lib/sopTitle.ts` | جديد | قواعد تحقق عنوان نموذج الرفع فقط. |
| `frontend/src/lib/sopPresentation.ts` | جديد | أسماء تنزيل مبنية على العنوان وإخفاء serial من اسم الملف المعروض. |
| `frontend/src/pages/sopPresentation.test.tsx` | جديد | اختبار العناوين والتنزيل والتنبيهات وترتيب الأقسام والأزرار وقيود العنوان. |
| `frontend/src/pages/ReviewPage.tsx` | معدل | استخدام عنوان SOP في الرأس والمعاينة والنشر والتنزيل مع بقاء حماية الإصدار. |
| `frontend/src/pages/SopDetailPage.tsx` | معدل | إزالة serial من صفحة الدليل والمعاينة والتنزيل. |
| `frontend/src/pages/ComplianceReportPage.tsx` | معدل | استبدال serial في العنوان والرجوع وبيانات التقرير والطباعة. |
| `frontend/src/components/workflow/VersionHistory.tsx` | معدل | أسماء تنزيل إصدارات مبنية على عنوان SOP. |
| `frontend/src/components/sops/SopGrid.tsx` | معدل | إخفاء serial من بطاقات الدليل والتسميات الميسرة. |
| `frontend/src/components/sops/SopList.tsx` | معدل | حذف عمود serial ونصه من العرضين المكتبي والمحمول. |
| `frontend/src/components/layout/NotificationsBell.tsx` | معدل | عرض عنوان SOP في نص الإشعار. |
| `frontend/src/lib/notifications.ts` | معدل | إضافة sopTitle لمعلومات العرض دون تغيير هوية الإشعار أو قواعد إصداره. |
| `frontend/src/components/admin/blockerMessages.ts` | معدل | تعريف SOP بعنوانه في أسباب منع التعديلات الإدارية. |
| `frontend/src/pages/admin/UserDetailsPage.tsx` | معدل | إخفاء serial من قائمة مشاركة المستخدم في SOPs. |
| `frontend/src/data/mock/dashboard.ts` | معدل | إزالة serial من رسالة نشاط تجريبية ظاهرة للمستخدم. |
| `frontend/src/content/mySops.en.ts` | معدل | نصوص الدور والفئات والبحث والمرشحات وحد العنوان والحالة الفارغة. |
| `frontend/src/content/reviews.en.ts` | معدل | نصوص مجموعات المراجعة وApprovals والقالب المعتمد على العنوان. |
| `frontend/src/content/internalReview.en.ts` | معدل | عنوان Submit for Review وReviewers والنصوص الصريحة للمهلة والقيود. |
| `frontend/src/content/workflow.en.ts` | معدل | Add Reviewers وقوالب عناوين SOP والمعاينة مع حفظ الإصدار. |
| `frontend/src/content/sops.en.ts` | معدل | نص البحث والقوالب المعتمدة على عنوان SOP. |
| `frontend/src/content/notifications.en.ts` | معدل | استبدال code بعنوان SOP في جميع قوالب التنبيهات. |
| `frontend/src/content/compliance.en.ts` | معدل | قوالب عنوان التقرير والطباعة والرجوع. |
| `frontend/src/content/admin.en.ts` | معدل | قالب سبب المنع يستخدم عنوان SOP. |
| `frontend/src/content/landing.en.ts` | معدل | إزالة serial من مثال نشاط ظاهر بصفحة التعريف. |
| `frontend/src/content/types.ts` | معدل | أنواع نصوص الواجهة والتلميحات الجديدة ووصف placeholders. |
| `frontend/src/components/workflow/approvalInterface.test.tsx` | معدل | حصر تحقق Workflow Status داخل قسمه بعد نقل Reviewers. |
| `frontend/src/components/workflow/internalReviewInterface.test.tsx` | معدل | تحديث التوقعات للقائمة القابلة للبحث والمهلة الثابتة وAdd Reviewers. |
| `frontend/src/components/workflow/reviewFlowInterface.test.tsx` | معدل | تحديث تحقق النافذة مع إبقاء اختبارات المهلات الأخرى. |
| `frontend/src/components/workflow/reviewRequestsCard.test.tsx` | معدل | استخدام عنوان Reviewers من content في التوقع القائم. |
| `docs/frontend-ui-integration.md` | جديد | توثيق دقيق للعقود الآمنة والقيود واعتماديات الخدمة. |
| `docs/frontend-ui-report.ar.md` | جديد | تقرير التسليم العربي وقائمة جميع الملفات. |

نتائج التحقق النهائية من `frontend`:

- `npm test`: ناجح، 571 اختبارًا في 44 ملفًا، دون إخفاقات.
- `npm run lint`: ناجح دون تحذيرات.
- `npm run build`: ناجح، ويشمل `tsc -b` ثم إنتاج Vite.
- `git diff --check`: ناجح.
- تدقيق مستقل للـdiff لم يجد خللًا مؤكدًا في الصلاحيات أو مسار الموافقة أو سلامة السجلات ضمن التغييرات. لم تتغير Providers أو workflow.ts أو internalReview.ts أو الخدمات أو Supabase.
- الاختبارات تشمل تحقق عرض بالمخرجات المولدة واختبارات المنطق؛ لم تُجرَ جولة تفاعل مرئية في متصفح فعلي.

حالة Git في worktree: 37 ملفًا متتبعًا معدلًا و16 ملفًا جديدًا، جميعها غير staged. الفرع `feat/frontend-ui-enhancements` والـHEAD ما زال `5fda6ccac57af52769501817941330b01c4b38dc`. مجلد العمل الأصلي على `develop` ما زال يحتفظ بالـmerge السابق والتغييرات الأصلية؛ يظهر فيه أيضًا `.worktrees/` لأنه موضع العمل المعزول. التسليم جاهز للمراجعة، مع اعتماديات الخدمة المذكورة أعلاه.
