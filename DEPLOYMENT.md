# دليل نشر وتحصين السيرفر لتطبيق "أبوي وأمي" (Production Deployment & Hardening Checklist)

يقدم هذا الدليل خطوات عملية شاملة خطوة بخطوة لنشر التطبيق على سيرفر افتراضي (VPS يعمل بنظام Ubuntu 22.04 أو 24.04 LTS)، لضمان أعلى درجات الخصوصية والأمان ومنع أي ثغرات أو اعتراض للبيانات (Zero Eavesdropping).

---

## 1. المتطلبات الأساسية (Prerequisites)
1. خادم VPS (بمواصفات لا تقل عن 1 vCPU و 2GB RAM).
2. عنوان IP عام وثابت (Static Public IP).
3. اسم نطاق (Domain Name) مع سجلين A:
   - `myparents.yourdomain.com` (لتطبيق الويب وإشارات WebRTC).
   - `turn.yourdomain.com` (لسيرفر CoTURN).

---

## 2. الخطوة الأولى: تحصين الجدار الناري (UFW Firewall)

قم بالدخول إلى السيرفر عبر SSH وقم بإغلاق جميع المنافذ غير المستخدمة وحصر الوصول على المنافذ الضرورية فقط:

```bash
# تحديث الحزم الأساسية
sudo apt update && sudo apt upgrade -y

# تعيين القواعد الافتراضية للجدار الناري
sudo ufw default deny incoming
sudo ufw default allow outgoing

# فتح منفذ SSH (تأكد من عدم قفل نفسك خارج السيرفر)
sudo ufw allow 22/tcp

# فتح منافذ الويب (HTTPS & HTTP)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# فتح منافذ خادم CoTURN (STUN/TURN)
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp

# فتح نطاق منافذ ترحيل وسائط WebRTC (UDP Media Relay)
sudo ufw allow 49152:65535/udp

# تفعيل الجدار الناري
sudo ufw enable
sudo ufw status verbose
```

---

## 3. الخطوة الثانية: استخراج شهادات الأمان المجانية (Let's Encrypt SSL)

```bash
# تثبيت Certbot
sudo apt install certbot python3-certbot-nginx -y

# استخراج الشهادات لنطاق التطبيق ونطاق خادم الترحيل
sudo certbot certonly --standalone -d myparents.yourdomain.com -d turn.yourdomain.com
```

ستجد الشهادات مخزنة في:
`/etc/letsencrypt/live/myparents.yourdomain.com/`
`/etc/letsencrypt/live/turn.yourdomain.com/`

---

## 4. الخطوة الثالثة: تثبيت وإعداد خادم CoTURN

سيرفر CoTURN يضمن استقرار المكالمة وتخطي جدران الحماية للشبكات (Symmetric NAT) مع تشفير حزم الـ Relay:

```bash
# تثبيت coturn
sudo apt install coturn -y

# تفعيل الخدمة تلقائياً عند إقلاع النظام
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn

# نسخ ملف الإعدادات المحصن
sudo cp config/turnserver.conf /etc/turnserver.conf

# تأكد من استبدال اسم النطاق والمفتاح السري في /etc/turnserver.conf بما يطابق ملف .env لديك:
# static-auth-secret=YOUR_GENERATED_SECRET_KEY
# realm=turn.yourdomain.com

# منح خادم coturn صلاحية قراءة شهادات SSL
sudo chown -R turnserver:turnserver /etc/letsencrypt/archive/
sudo chown -R turnserver:turnserver /etc/letsencrypt/live/

# إعادة تشغيل خدمة CoTURN والتحقق من حالتها
sudo systemctl restart coturn
sudo systemctl status coturn
```

---

## 5. الخطوة الرابعة: نشر تطبيق Node.js وإدارته عبر PM2

```bash
# تثبيت بيئة Node.js الحديثة (LTS)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs build-essential

# تثبيت مدير العمليات PM2 عالمياً
sudo npm install -g pm2

# الانتقال لمجلد المشروع وتثبيت الاعتماديات
cd /var/www/my-parents-call
npm install --omit=dev

# إعداد ملف البيئة .env
cp .env.example .env
nano .env # قم بتعبئة المفاتيح الحقيقية والـ PIN المشفر

# تشغيل التطبيق بالخلفية عبر PM2
pm2 start server.js --name "my-parents-call" -i max
pm2 save
pm2 startup
```

---

## 6. الخطوة الخامسة: إعداد Nginx كوسيط عكسي محصن (Reverse Proxy)

```bash
# تثبيت Nginx
sudo apt install nginx -y

# نسخ ملف إعدادات Nginx المحصن
sudo cp config/nginx.conf /etc/nginx/sites-available/my-parents-call

# تفعيل الموقع وفحص صحة الإعدادات
sudo ln -s /etc/nginx/sites-available/my-parents-call /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t

# إعادة تشغيل Nginx
sudo systemctl restart nginx
sudo systemctl status nginx
```

---

## 7. الخطوة السادسة: الحماية من هجمات التخمين عبر Fail2Ban

```bash
# تثبيت Fail2ban
sudo apt install fail2ban -y

# تشغيل الخدمة لحظر أي عناوين IP تحاول التخمين عبر SSH
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

---

## 8. قائمة التحقق النهائية قبل تسليم التطبيق للوالدين (Verification Checklist)

- [x] **التشفير الإجباري**: افتح الموقع عبر `http://` وتأكد أنه يتحول تلقائياً إلى `https://`.
- [x] **فحص DTLS-SRTP**: في متصفح Chrome أثناء المكالمة، افتح التبويب: `chrome://webrtc-internals` وتأكد أن نوع التشفير هو: `cipher: TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256` أو `SRTP_AEAD_AES_128_GCM`.
- [x] **فحص شهادة STUN/TURN**: تحقق من أن `/api/turn-credentials` ترجع بيانات اعتماد مؤقتة فقط بعد تقديم الـ JWT.
- [x] **حماية الرمز السري**: حاول إدخال PIN خاطئ 5 مرات متتالية وتأكد أن الـ Rate Limiter يحظر الطلب فوراً.
- [x] **سهولة الاستخدام للوالدين**: قم بحفظ الرابط في شاشة الهاتف الرئيسية للوالد والوالدة كـ (PWA / اختصار للشاشة الرئيسية) مع اختيار دور كل منهما وتخزين الـ PIN للمرة الأولى فقط.
