# SmartID Portal – audit de securitate pentru producție

## Critic înainte de producție
1. **Firestore Security Rules trebuie să fie autoritatea reală pentru roluri.** Ascunderea butoanelor în JavaScript nu este control de acces. Orice scriere (users, videos, stores, approvals) trebuie validată server-side în Rules.
2. **Activează Firebase App Check** pentru aplicația web și impune App Check pe Firestore după testare.
3. **Admin principal:** MFA obligatoriu, parolă unică, fără cont partajat. Recomand MFA și pentru colegii cu edit/delete.
4. **Authorized domains:** păstrează doar domeniul GitHub Pages/producție și domeniile necesare; elimină domeniile de test nefolosite.
5. **Least privilege:** Carrefour/Franciză doar read pentru materiale aprobate; Support add-only nu poate update/delete/approve; doar colegii full-manage pot update/delete; doar admin principal poate approve/reject și modifica users/stores.
6. **Audit logs:** utilizatorii normali nu trebuie să poată modifica/șterge sessions, materialViews, shares, teamActivity. Ideal acestea se scriu prin Cloud Functions dacă trebuie protejate împotriva falsificării.
7. **Validare URL/materiale:** acceptă doar protocoale HTTPS și domenii aprobate pentru video/proceduri. Nu permite javascript:, data: sau HTML arbitrar.
8. **Backup:** export Firestore programat + procedură de restaurare testată.

## Aplicație web
- Firebase config public în client este normal; securitatea NU trebuie bazată pe ascunderea cheilor.
- Dependențele externe trebuie pin-uite la versiuni exacte. În acest build SheetJS este pin-uit la 0.18.5.
- Iframe-ul viewer are sandbox și referrer policy mai restrictive.
- Pentru producție pe hosting controlat, setează headere HTTP: Content-Security-Policy, X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy și frame-ancestors. GitHub Pages nu oferă control complet asupra acestor headere.

## Teste înainte de go-live
- Test negativ cu fiecare rol direct din DevTools/REST: create/update/delete/approve.
- Test cont dezactivat și sesiune veche.
- Test URL malițios la material.
- Test acces direct la documente pending/rejected.
- Test că un user Carrefour nu poate citi Franciză/Support prin query direct.
- Test că add-only nu poate edita/șterge materialul altuia.
- Test rate/abuz pe loguri și views.

**Important:** acest audit nu activează automat reguli Firestore noi, pentru a nu rupe producția fără testare. Regulile trebuie validate într-un proiect staging înainte de deploy.
