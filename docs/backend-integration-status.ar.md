> **سجل تاريخي (تم تجاوزه في 31 أكتوبر 2026).** يصف هذا التقرير الفرع عندما كانت قيمة `FRONTEND_PROTOTYPE` تساوي `true`. أُزيل وضع النموذج الأولي: يعمل التطبيق الآن على Supabase الحقيقي من `develop`، ومواعيد أيام العمل بانتظار التفعيل، وحد ملاحظة الإرسال 500 حرف، وملفات SQL الخاصة بالمواعيد مقترحة في `supabase/proposals/`. الحالة الحالية في `supabase/INTEGRATION_REVIEW.md`.
>
> **Historical record (superseded on 31 October 2026).** This describes the branch while `FRONTEND_PROTOTYPE` was `true`. Prototype mode has since been removed: the app runs on the real Supabase backend from `develop`, working-day deadlines are pending activation (`frontend/src/lib/deadlinePolicy.ts`), the submission-note limit is 500, and the deadline SQL is a proposal in `supabase/proposals/`. See `supabase/INTEGRATION_REVIEW.md` for the current state.

# حالة ملفات Backend التجريبية — محفوظة وغير مفعّلة

هذا التقرير يصف الحالة الحالية على `feat/frontend-ui-enhancements` بعد commit المحفوظ `a11246b`، ويحل محل افتراضات وتقارير التكامل السابقة. مخطط قاعدة البيانات وSupabase غير معتمدين من الفريق. المتابعة الحالية للواجهة فقط؛ لم تُعدّل ملفات SQL أو الخدمات أو FastAPI، ولم تُشغّل migrations أو اختبارات قاعدة بيانات أو اتصالات Supabase حقيقية.

التطبيق يعمل دون credentials باستخدام الهوية والبيانات والانتقالات المحلية الموجودة. قيمة `FRONTEND_PROTOTYPE` ثابتة؛ وجود ملف بيئة لا يفعّل التكامل التجريبي. الفحوصات الحالية تخص React/TypeScript والانتقالات المحلية والخدمات المعزولة بواسطة mocks، ولا تثبت صلاحية المخطط أو RLS أو RPCs في مشروع حقيقي.

## الملفات الموجودة التي يلزم استبعاد تغييراتها غير المعتمدة من PR الواجهة

الملفات التالية موجودة بالفعل في تاريخ الفرع، خصوصًا commit المختلط `a3237e6`. لم تُنشأ أو تُعدّل في هذه المتابعة:

| المسار | التصنيف |
| --- | --- |
| `supabase/migrations/20261025110000_drop_prototype_tables.sql` | Migration تجريبي؛ يتضمن إزالة جداول ويحتاج مراجعة مستقلة قبل أي تنفيذ |
| `supabase/migrations/20261025120000_people_and_roles.sql` | الأشخاص والأدوار |
| `supabase/migrations/20261026120000_sops_and_versions.sql` | SOPs والإصدارات |
| `supabase/migrations/20261026130000_co_authors.sql` | المؤلفون المشاركون |
| `supabase/migrations/20261026140000_compliance_checks.sql` | فحوصات الامتثال |
| `supabase/migrations/20261026150000_internal_review.sql` | المراجعة الداخلية؛ الملف موجود الآن، خلافًا لتقرير سابق |
| `supabase/migrations/20261029000000_review_deadline_helpers.sql` | دوال مواعيد تجريبية |
| `supabase/migrations/20261029010000_internal_review_working_days.sql` | ربط تجريبي لأيام العمل |
| `supabase/seed.sql` | بيانات تجريبية للمخطط |
| `supabase/tests/calendar_helpers.sql` | اختبار SQL تجريبي |
| `supabase/tests/calendar_parity.mjs` | مطابقة تقويم تجريبية |
| `supabase/tests/internal_review_rpc.sql` | اختبار RPC تجريبي |

كذلك تبقى ملفات `frontend/src/services/` التجريبية وتغييراتها واختباراتها محفوظة: `auth.ts`، `supabase.ts`، `compliance.ts`، `files.ts`، `people.ts`، `review.ts`، `sops.ts` واختبارات `.test.ts` المقابلة. المسارات النشطة للنموذج المحلي لا تستورد هذه الخدمات ولا تطلب بيانات منها.

توجد أيضًا ملفات واجهة مختلطة بتوصيلات تجريبية محفوظة: providers، guards، الأنواع، تحميل البيانات وروابط الملفات. لذلك لا يكفي استبعاد مجلد `supabase/` وحده عند تجهيز PR؛ يجب مراجعة تلك الأجزاء يدويًا. لا تُستبدل إعدادات Supabase الأساسية الموجودة في قاعدة الفريق ولا تُحذف تلقائيًا.

## الفصل الآمن المقترح — لم يُنفّذ

1. اعتماد نقطة الدمج ومصدر frontend المقصود مع مالك المستودع بعد معالجة دمج `develop` المعلّق من طرفه. لا يُجرى merge أو rebase تلقائيًا.
2. بعد الموافقة الصريحة، تجهيز changeset للواجهة فقط باستخدام قائمة ملفات وhunks مراجَعة، مع الفصل اليدوي للملفات المختلطة. لا يُؤخذ commit المختلط كاملًا.
3. استبعاد تغييرات schema/migrations/seed/اختبارات SQL وخدمات RPC/Auth/Storage التجريبية غير المعتمدة، مع الإبقاء على ملفاتها وتاريخها في الفرع الحالي.
4. التأكد من أن المرشح يعمل دون credentials، ثم تشغيل اختبارات الواجهة وTypeScript وlint والبناء و`git diff --check` عليه.
5. مراجعة diff النهائي قبل أي commit أو push أو فتح PR أو دمج، وفق موافقة المستخدم.

لم يُنفّذ فصل أو حذف أو إعادة كتابة تاريخ أو إنشاء worktree/فرع إضافي. لم تُغيّر حالة worktree الأصلي على `develop` أو الدمج المعلّق أو package-lock أو الأرشيفات الموجودة فيه.

## ما ينتظر قرار الفريق أو تكاملًا لاحقًا

- مصدر معتمد للـDivisions وعلاقاتها بالأقسام؛ لا تُختلق أسماء أو علاقات.
- عقد جولات وتكليفات المراجعة الخارجية التي يتحكم فيها المؤلف، وربط دليل اكتمالها بالإصدار والجولة الداخلية الصحيحين.
- هوية موثوقة وصلاحيات RLS/RPC، حفظ دائم للمستندات والتاريخ، توقيت خادم موثوق، سحب مجدول وتنبيهات بريدية.
- تقويم العطلات الرسمية إن كان مطلوبًا؛ التطبيق الحالي يستبعد الجمعة والسبت فقط.

نتائج SQL المذكورة في نسخ أقدم من التقارير تخص عملًا تجريبيًا سابقًا؛ لا يُعاد تقديمها بوصفها تحققًا حاليًا أو اعتمادًا للتكامل.
