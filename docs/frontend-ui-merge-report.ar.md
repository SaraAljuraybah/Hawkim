# تقرير حل دمج الواجهة — 2026-10-31

تم حل التعارضات في worktree `.worktrees/frontend-ui-enhancements` على `feat/frontend-ui-enhancements` دون إنشاء commit أو إنهاء الدمج.

## أطراف الدمج والتحقق الأولي

- Ours: `120916509ec5aba2f13926848763a4674aaac1ec`.
- Theirs: `857ca66bb07b191e82e73dbd58ab84d1d62614bb` من `origin/develop`.
- Merge base: `5fda6ccac57af52769501817941330b01c4b38dc`.
- النسخة الاحتياطية `backup/frontend-ui-before-merge-20261031` تشير إلى Ours نفسه.
- فُحصت حالة Git ومراحل 1/2/3 والتغييرات ذات الصلة قبل التعديل. عدد الملفات المتعارضة الأصلي 47 (UU وAA). لم يُستخدم قبول شامل لأحد الفرعين أو reset أو abort.

## كيفية التوفيق بين الفرعين

| المجموعة | العدد | النتيجة |
| --- | --- | --- |
| النصوص والأنواع | 9 | Title Case من develop مع إبقاء حقول النموذج المحلي وأيام عمل الرياض والتاريخ، وإزالة التعريفات المكررة. عنوان المؤلف Reviewers وعنوان المراجع Internal Review Requests. |
| المكونات واختباراتها | 13 | الجمع بين الاختيار القابل للبحث والتحقق والتعامل مع العمليات غير المتزامنة وتحسينات العناوين والحقول المطلوبة. بقيت أفعال المراجعة في قسم Reviewers، والتاريخ للعرض. |
| App والحالة واختباراتها | 13 | حفظ العزل والإجراءات المحلية والحماية من الهوية القديمة مع إبقاء كود التكامل القادم في مسارات lazy غير مفعّلة. شاشة إعداد Supabase محفوظة في المسار غير المفعّل فقط. |
| الصفحات والمجال والخدمات | 12 | حفظ الوصف والوصول المرتبط بالإصدار والمواعيد الدقيقة والتاريخ، مع دمج تحسينات صفحة المؤلف والعداد والأخطاء. خدمات Backend محفوظة وغير مستعملة في النموذج المحلي. |

حُفظ البحث والمرشحات وGrid/List وتفضيل العرض، وإخفاء الأرقام التسلسلية، وتكليف المؤلف، والمراجعات المتوازية والقرارات المستقلة، والإرسال المستقل للاعتماد، وإلغاء الطلبات، والإشعارات، وعزل المستخدمين والنسخ.

مواعيد الطلبات الجديدة تبقى بأيام العمل في Asia/Riyadh: مهلة رد ثابتة يومَا عمل، ومدة مراجعة اختيارية 1–30 يوم عمل بعد القبول، مع استبعاد يوم القبول والجمعة والسبت. نهاية الموعد الجديد 23:59:59.999 بالرياض. لم تُحسب المواعيد التاريخية من جديد، ولم تُغيّر قيود مواعيد الاعتماد.

حُفظت من develop تسميات Title Case، وتحسينات صفحة المؤلف دون شارة حالة مكررة في الرأس، والترتيب Workflow Status → Authors → SOP History → Compliance → Reviewers → Review Timeline، وحقول Upload SOP المطلوبة وعداد 50 حرفًا. بقي تحقق 50 حرفًا داخل التعديل نفسه، إضافةً إلى maxLength في النموذج.

## إصلاحات توافق مرتبطة بالدمج

- أزال الدمج الآلي مولّد `lib/sopCodes.ts` لأن التكامل يولّد المعرف في الخادم؛ أُبقي الملف الأصلي لأن النموذج المحلي يحتاجه. مسار التكامل غير المفعّل يبقى معتمدًا على معرف الخادم.
- دمج callbacks حذف الإصدار وإزالة المؤلف المشارك كان يؤدي إلى استدعاء التعديل مرتين: await ثم استدعاء إضافي. أصبح التعديل مرة واحدة، ولا تُغلق النافذة عند الفشل. أُضيفت أربعة اختبارات لمنع التراجع.
- جرى تحديث fixtures لسياقات الأقسام وSession، مع الحفاظ على شروط التحقق.
- رُبطت تأكيدات الصلاحيات السلبية بالنصوص الحالية حتى لا تنجح خطأً بعد تغيير capitalization.
- عُدلت تعليمات README وDEMO_ACCOUNTS: الحسابات الفعالة هي .demo والتشغيل محلي بلا credentials؛ تفاصيل develop الخاصة بـ.test وSupabase محفوظة تحت عنوان تكامل تجريبي غير مفعّل.

## الملفات المتعارضة الأصلية المحلولة

- `frontend/src/App.tsx`
- `frontend/src/components/mySops/AuthoredSopList.tsx`
- `frontend/src/components/reviews/InternalReviewActions.tsx`
- `frontend/src/components/workflow/AddCoAuthorsDialog.tsx`
- `frontend/src/components/workflow/FileDialog.tsx`
- `frontend/src/components/workflow/InternalReviewPanel.tsx`
- `frontend/src/components/workflow/ResponseDialog.tsx`
- `frontend/src/components/workflow/SubmitDialog.tsx`
- `frontend/src/components/workflow/VersionHistory.tsx`
- `frontend/src/components/workflow/approvalInterface.test.tsx`
- `frontend/src/components/workflow/internalReviewInterface.test.tsx`
- `frontend/src/components/workflow/reviewFlowInterface.test.tsx`
- `frontend/src/components/workflow/reviewRequestsCard.test.tsx`
- `frontend/src/components/workflow/reviewerDeadlines.test.tsx`
- `frontend/src/content/auth.en.ts`
- `frontend/src/content/compliance.en.ts`
- `frontend/src/content/internalReview.en.ts`
- `frontend/src/content/mySops.en.ts`
- `frontend/src/content/reviewFlow.en.ts`
- `frontend/src/content/reviews.en.ts`
- `frontend/src/content/sops.en.ts`
- `frontend/src/content/types.ts`
- `frontend/src/content/workflow.en.ts`
- `frontend/src/hooks/useFileUrl.ts`
- `frontend/src/lib/compliance.ts`
- `frontend/src/lib/internalReview.ts`
- `frontend/src/pages/ReviewPage.tsx`
- `frontend/src/pages/SignInPage.tsx`
- `frontend/src/pages/SopDetailPage.tsx`
- `frontend/src/pages/SopWorkflowPage.tsx`
- `frontend/src/pages/UploadSopPage.tsx`
- `frontend/src/services/review.test.ts`
- `frontend/src/services/review.ts`
- `frontend/src/services/sops.test.ts`
- `frontend/src/services/sops.ts`
- `frontend/src/state/DepartmentsProvider.tsx`
- `frontend/src/state/GuidelinesProvider.tsx`
- `frontend/src/state/SessionProvider.test.tsx`
- `frontend/src/state/SessionProvider.tsx`
- `frontend/src/state/SopsProvider.tsx`
- `frontend/src/state/UsersProvider.tsx`
- `frontend/src/state/approvalPermissions.test.tsx`
- `frontend/src/state/complianceRun.test.tsx`
- `frontend/src/state/directoryAccessPermissions.test.tsx`
- `frontend/src/state/sessionContext.ts`
- `frontend/src/state/sopsContext.ts`
- `frontend/src/state/useLoadAfterSignIn.ts`

## Backend والقرارات المتبقية

`FRONTEND_PROTOTYPE` بقي ثابتًا على true. لا تُحمّل المسارات النشطة عميل Supabase، ولا يفعّله ملف البيئة. لم تُشغّل migrations أو SQL أو reset أو نشر.

المهاجرات الموجودة من الطرفين محفوظة دون تعديلها. ملف `supabase/scripts/reset_test_sops.sql` القادم آليًا من develop محفوظ كما ورد، ولم يُنفّذ. حذف .gitkeep القادم من develop لا يمس بيانات.

متطلب الامتثال الحالي للنموذج المحلي بقي كما كان. شرط GVP بحسب إعداد القسم من develop محفوظ في مسار التكامل غير المفعّل، وله اختبار مستقل دون اتصال قاعدة بيانات. تفعيل تلك السياسة على التكامل الحقيقي، واعتماد حقول المواعيد الدقيقة وعقود التكليف الخارجي والمصادقة، يحتاج قرار الفريق؛ هذا الدمج لا يقرّ البنية التجريبية ولا يفعّلها.

## التحقق

- الاختبارات المركزة للمكونات: 76 اختبارًا في 7 ملفات؛ للحالة والتشغيل المحلي: 68 اختبارًا في 6 ملفات؛ لاختبارات assertions: 20 اختبارًا في ملفين؛ ولإصلاحات الدمج الأخرى: 62 اختبارًا في 6 ملفات. نجحت جميعها.
- المجموعة الكاملة بعد آخر إصلاح: `npm test` نجح — 764 اختبارًا في 66 ملفًا.
- اختبار UTC المركّز: 41 اختبارًا في 3 ملفات نجحت، للتحقق من حدود الرياض واستقلال النتائج عن منطقة التشغيل.
- `npm run lint` نجح دون أخطاء أو تحذيرات. سكربت المشروع يستخدم Oxlint؛ لم يُضف ESLint أو أي dependency.
- `npm run build` نجح، ويتضمن TypeScript `tsc -b` ثم بناء Vite للإنتاج.
- `git diff --check` و`git diff --cached --check` نجحا. لا توجد علامات تعارض أو مسارات غير محلولة.
- في أول تشغيل كامل فشلت ست حالات بسبب labels أو fixtures للسياقات. صُححت مع إبقاء assertions الصلاحيات والتاريخ، وأصبح الفحص الكامل أخضر.
- لم تُشغّل اختبارات قاعدة بيانات أو تكامل حي أو متصفح بصري؛ الخدمات في الاختبارات معزولة بـmocks.

## حالة Git

- جرى تعليم الملفات الـ47 كمحلولة، وإبقاء مولّد المعرفات المحلي، وتجهيز إصلاحات التوافق والاختبارات والتوثيق للمراجعة في index.
- `HEAD = 1209165` و`MERGE_HEAD = 857ca66` لم يتغيرا؛ النسخة الاحتياطية ما زالت تشير إلى `1209165`.
- الدمج ما زال جاريًا دون merge commit. لم يحدث commit أو push أو PR أو تعديل مباشر لفرع develop.

يبقى worktree الأصلي على develop ودمجه المعلّق وتعديل package-lock والأرشيفات دون مساس. الحل جاهز لمراجعة المستخدم بعد نجاح الفحوصات؛ إتمام merge commit أو push أو PR ينتظر موافقته.
