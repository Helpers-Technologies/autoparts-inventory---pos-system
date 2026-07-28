# Bosta Webhook على Hostinger

الخدمة تعمل على Hostinger Shared Hosting باستخدام PHP 8.1+ وMySQL، ولا تحتاج
تشغيل Node.js أو سيرفر دائم.

## التجهيز

1. من hPanel أنشئ قاعدة MySQL ومستخدمًا لها.
2. افتح phpMyAdmin ونفّذ `schema.sql`.
3. انسخ `config.example.php` إلى `config.php` وضع بيانات MySQL.
4. من شاشة التكاملات داخل التطبيق اضغط «توليد مفاتيح آمنة».
5. ضع قيمة مفتاح Bosta في `bosta_webhook_secret`، وقيمة مفتاح مزامنة التطبيق
   في `desktop_poll_token`.
6. أنشئ الـSubdomain باسم `api-partflow.helpers-tech.com` من hPanel وفعّل SSL.
7. ارفع محتويات الحزمة إلى مجلد `public_html` الخاص بهذا الـSubdomain.
8. اختبر: `https://api-partflow.helpers-tech.com/health`.

رابط Webhook الذي يوضع في التطبيق ولوحة Bosta:

`https://api-partflow.helpers-tech.com/v1/bosta/webhook`

اسم مفتاح التوثيق في Bosta:

`X-Autoparts-Webhook-Key`

القيمة هي نفس `bosta_webhook_secret`. التطبيق يسحب الأحداث من مسار محمي منفصل
ويؤكد معالجتها، ولا تُرسل مفاتيح MySQL أو مفتاح مزامنة التطبيق إلى Bosta.
