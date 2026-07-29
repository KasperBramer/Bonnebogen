# Bønnebogen

En kaffelog for to. Hver kop får et løbenummer, et billede og **to** domme — jeres hver især. Appen holder styr på hvor tit I er enige.

Statisk site på GitHub Pages + Supabase som database, login og billedlager. Ingen server at vedligeholde, ingen byggeproces, ingen npm. Gratis på Supabases free tier.

---

## Sådan får du den op at køre

Regn med 15-20 minutter første gang.

### 1. Opret et Supabase-projekt

Gå til [supabase.com](https://supabase.com), log ind med GitHub, og tryk **New project**.

- Vælg region **Central EU (Frankfurt)** — tættest på jer.
- Gem database-adgangskoden et sikkert sted (du får den kun én gang).

Projektet er klar efter et par minutter.

### 2. Byg databasen

Gå til **SQL Editor** → **New query**. Åbn `supabase/setup.sql`, kopier hele filen ind, og tryk **Run**.

Den opretter tabeller, sikkerhedsregler og billed-bucket på én gang. Du skulle gerne se "Success".

### 3. Opret jeres to brugere

**Authentication** → **Users** → **Add user** → **Create new user**.

Opret én til dig og én til din kæreste. Sæt et kodeord for hver, og slå **Auto Confirm User** til, så I slipper for bekræftelses-mails.

Rækkefølgen betyder noget for udseendet: den første bruger bliver kobolt-blå, den anden jade-grøn.

### 4. Luk døren efter jer

**Authentication** → **Sign In / Providers** → **Email**. Slå **Allow new users to sign up** fra.

Uden det trin kan hvem som helst med linket oprette en bruger og læse jeres log. Med det slået fra findes der kun de to konti, du selv har oprettet.

### 5. Indsæt nøglerne

**Project Settings** → **API**. Kopier **Project URL** og **anon public**-nøglen ind i `assets/config.js`:

```js
export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

De to værdier må gerne ligge offentligt på GitHub. `anon`-nøglen er offentlig efter design — det er sikkerhedsreglerne i databasen, der bestemmer hvem der må se og skrive hvad, og dem satte du op i trin 2. Den nøgle du **aldrig** må lægge på GitHub, hedder `service_role`. Rør den ikke.

### 6. Læg det på GitHub

```bash
git init
git add .
git commit -m "Bønnebogen"
git branch -M main
git remote add origin https://github.com/DIT-BRUGERNAVN/bonnebogen.git
git push -u origin main
```

I repoet: **Settings** → **Pages** → under *Build and deployment* vælg **Deploy from a branch**, branch `main`, mappe `/ (root)`. Gem.

Efter et minut ligger siden på `https://DIT-BRUGERNAVN.github.io/bonnebogen/`.

### 7. Fortæl Supabase hvor siden bor

**Authentication** → **URL Configuration**:

- **Site URL**: `https://DIT-BRUGERNAVN.github.io/bonnebogen/`
- **Redirect URLs**: tilføj samme adresse, og gerne `http://localhost:8000/` hvis du vil rette i den lokalt.

Det bruges kun til "send mig et login-link". Almindeligt login med kodeord virker uden.

### 8. Læg den på hjemmeskærmen

Åbn siden på telefonen → del-knappen → **Føj til hjemmeskærm**. Så åbner den i fuld skærm uden browserlinje, og I forbliver logget ind.

---

## Test lokalt

`file://` virker ikke — browsere blokerer ES-moduler derfra. Start en lille server:

```bash
python3 -m http.server 8000
```

og åbn `http://localhost:8000`.

---

## Sådan er den skruet sammen

```
index.html               hele siden
assets/style.css         al styling
assets/app.js            al logik
assets/config.js         dine to nøgler — den eneste fil du skal røre
supabase/setup.sql       databasen, køres én gang
manifest.webmanifest     så den kan ligge på hjemmeskærmen
```

Tre tabeller:

| Tabel | Indhold |
|---|---|
| `profiles` | ét navn pr. bruger, oprettes automatisk ved login |
| `coffees` | selve kaffen: navn, rister, oprindelse, sted, metode, billede, løbenummer |
| `ratings` | én dom pr. person pr. kaffe: stjerner + note. Unik på (kaffe, person) |

Billeder ligger i en **privat** bucket. Appen henter tidsbegrænsede links, så ingen kan tilgå dem uden at være logget ind. Fotos skaleres ned til 1600 px og komprimeres i browseren før upload, så I ikke brænder gratis-kvoten af på 4 MB-telefonbilleder.

Sikkerhed: Row Level Security er slået til på alle tre tabeller. Alle indloggede kan læse alt — I er jo kun jer to — men man kan kun rette og slette sine egne rækker. Din kæreste kan ikke ændre din dom, og du kan ikke ændre hendes.

---

## Hvad koster det

Ingenting, med god margin. Supabase free tier giver 500 MB database og 1 GB fillager. Med komprimerede billeder på ca. 300 KB er der plads til over 3.000 kopper kaffe. GitHub Pages er gratis for offentlige repos.

Én ting at vide: Supabase sætter gratis-projekter på pause efter en uge helt uden aktivitet. Drikker I kaffe oftere end det, sker det aldrig — og skulle det ske, vækker et enkelt tryk i Supabase-dashboardet det igen.

---

## Hvis noget driller

**"Bønnebogen mangler sine nøgler"** — trin 5 er ikke gjort færdigt.

**Login siger "Invalid login credentials"** — brugeren findes ikke, eller kodeordet er forkert. Opret den igen under Authentication → Users, eller brug **Send mig et login-link i stedet**.

**Kafferne loader ikke, tom side** — åbn browserens konsol. Er fejlen om `permission denied` eller RLS, er `setup.sql` ikke kørt helt igennem. Kør den igen; den kan sagtens køres to gange.

**Billeder vises ikke** — tjek at bucket'en `kaffebilleder` findes under Storage. Ellers: kør `setup.sql` igen.

**Siden er blank på GitHub Pages** — vent et par minutter på første deploy, og tjek at Pages peger på `main` og `/ (root)`.

---

## Idéer til næste version

Ting jeg holdt ude for at få jer i gang hurtigt:

- **Kort** over hvor kafferne er drukket, hvis I gemmer koordinater sammen med stedet
- **Genbestillingsliste** — alt I begge har givet 5 stjerner
- **Årsopgørelse** i december: flest kopper, største uenighed, bedste fund
- **Blind smagning** — skjul partnerens dom indtil du selv har afgivet din. Det ville faktisk gøre "enige"-tallet ærligt
- **Smagsnoter som tags** i stedet for fritekst, så I kan se om I altid falder for det samme

Blind smagning er den, jeg selv ville lave næste gang. Lige nu kan man se den andens dom, før man afgiver sin, og så bliver man påvirket.
