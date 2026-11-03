// Help content: the Help modal's manual (components/HelpModal.tsx) and the
// quick start guide shown on a user's first login (components/QuickStart.tsx).
//
// Clips live in public/help/<clip>.mp4 with a poster frame at public/help/<clip>.jpg.
// They are silent recordings of the real tool on fictional demo data, with the tool
// in Dutch; the text next to them follows the language toggle. A topic whose clip
// file is missing just shows its text. When a feature changes, update its text here
// and re-record its clip.

import type { Lang } from './types'

type Text = Record<Lang, string>
type Steps = Record<Lang, string[]>

export type HelpGroupId = 'board' | 'lead' | 'booking' | 'tasks' | 'other' | 'admin'

export const HELP_GROUPS: Array<{ id: HelpGroupId; title: Text }> = [
  { id: 'board',   title: { nl: 'Je bord',                     en: 'Your board' } },
  { id: 'lead',    title: { nl: 'Het lead-scherm',             en: 'The lead screen' } },
  { id: 'booking', title: { nl: 'Afspraak plannen & afronden', en: 'Booking and closing a lead' } },
  { id: 'tasks',   title: { nl: 'Taken',                       en: 'Tasks' } },
  { id: 'other',   title: { nl: 'Overig',                      en: 'Other' } },
  { id: 'admin',   title: { nl: 'Admin',                       en: 'Admin' } },
]

export interface HelpTopic {
  id: string
  group: HelpGroupId
  /** File name in public/help/ without extension. */
  clip?: string
  adminOnly?: boolean
  title: Text
  steps: Steps
}

export function clipSrc(clip: string): string { return `/help/${clip}.mp4` }
export function clipPoster(clip: string): string { return `/help/${clip}.jpg` }

export const HELP_TOPICS: HelpTopic[] = [
  // ── Your board ──────────────────────────────────────────────────────────────
  {
    id: 'request-leads', group: 'board', clip: 'request-leads',
    title: { nl: '📥 Leads aanvragen', en: '📥 Requesting leads' },
    steps: {
      nl: [
        'Klik op "Leads aanvragen" bovenaan je bord.',
        'Na een paar seconden staan je nieuwe leads in de tabel onder "Mijn leads". Leads worden toegewezen uit de MQL-fase.',
        'Daarna moet je 60 seconden wachten voor je opnieuw kunt aanvragen. De knop telt af.',
        'Zie je na het aftellen geen nieuwe leads? Klik op "↻ Vernieuwen" en kijk of je een Slack-bericht van HubSpot hebt gekregen.',
      ],
      en: [
        'Click "Request Leads" at the top of your board.',
        'After a few seconds your new leads appear in the table under "My Leads". Leads are assigned from the MQL stage.',
        'You then wait 60 seconds before you can request again. The button counts down.',
        'No new leads after the countdown? Click "↻ Refresh" and check whether you got a Slack message from HubSpot.',
      ],
    },
  },
  {
    id: 'board', group: 'board', clip: 'board',
    title: { nl: '📋 Je leads op het bord', en: '📋 Your leads on the board' },
    steps: {
      nl: [
        '"Mijn leads" toont je leads in de MQL-fase, met wanneer ze zijn aangevraagd, telefoon, product, call outcome, herkomst en lead score.',
        'Klik op een kolomkop om te sorteren. Bij Product en Call outcome kun je ook filteren; "Wissen" haalt het filter weg.',
        'Klik op een lead om het lead-scherm te openen.',
        '"↻ Vernieuwen" haalt je leads opnieuw op uit HubSpot.',
      ],
      en: [
        '"My Leads" shows your leads in the MQL stage, with when they were requested, phone, product, call outcome, origin and lead score.',
        'Click a column header to sort. Product and Call outcome can also be filtered; "Clear" removes the filter.',
        'Click a lead to open the lead screen.',
        '"↻ Refresh" reloads your leads from HubSpot.',
      ],
    },
  },
  {
    id: 'all-leads', group: 'board', clip: 'all-leads',
    title: { nl: '🔍 Alle leads zoeken', en: '🔍 Searching all leads' },
    steps: {
      nl: [
        'Klik op het tabblad "Alle leads".',
        'Zoek op naam. Een deel van de naam werkt ook. Je vindt leads van iedereen en in elke fase.',
        'Je ziet de eigenaar en de fase van elke lead.',
        '"Openen" opent de lead. "Claimen" zet de lead op jouw naam.',
      ],
      en: [
        'Click the "All leads" tab.',
        'Search by name. Part of the name works too. You find leads of everyone, in every stage.',
        'You see the owner and stage of each lead.',
        '"Open" opens the lead. "Claim" assigns the lead to you.',
      ],
    },
  },
  {
    id: 'new-lead', group: 'board', clip: 'new-lead',
    title: { nl: '➕ Nieuwe lead aanmaken (inkomend gesprek)', en: '➕ Creating a new lead (inbound call)' },
    steps: {
      nl: [
        'Klik op "+ Nieuwe lead" naast "Leads aanvragen".',
        'Staat de beller al in HubSpot? Kies "Ja — bestaand contact" en zoek op telefoonnummer of e-mail. Anders kies je "Nee — nieuw contact" en vul je voornaam, achternaam en e-mail of telefoon in.',
        'Vul het adres en het product in en klik op "Lead aanmaken".',
        'De lead wordt in HubSpot aangemaakt en staat op je bord.',
      ],
      en: [
        'Click "+ New lead" next to "Request Leads".',
        'Is the caller already in HubSpot? Choose "Yes — existing contact" and search by phone or email. Otherwise choose "No — new contact" and enter first name, last name and email or phone.',
        'Fill in the address and product and click "Create lead".',
        'The lead is created in HubSpot and is on your board.',
      ],
    },
  },
  {
    id: 'performance', group: 'board', clip: 'performance',
    title: { nl: '📊 Je prestaties', en: '📊 Your performance' },
    steps: {
      nl: [
        'Klik op 📊 rechtsboven.',
        'Kies Vandaag, Week of Maand.',
        'Verwerkte leads = leads die de MQL-fase hebben verlaten. Je ziet ook hoeveel er SQL zijn geworden en hoeveel Lost.',
      ],
      en: [
        'Click 📊 at the top right.',
        'Pick Today, Week or Month.',
        'Leads processed = leads that left the MQL stage. You also see how many became SQL and how many went Lost.',
      ],
    },
  },

  // ── The lead screen ─────────────────────────────────────────────────────────
  {
    id: 'lead-screen', group: 'lead', clip: 'lead-screen',
    title: { nl: '🗂 Het lead-scherm', en: '🗂 The lead screen' },
    steps: {
      nl: [
        'Links staat alles over de klant: Lead informatie, Configurator & notities, Recente activiteit, Andere leads van klant en de Call outcome. Rechts staat het playbook.',
        'Recente activiteit toont gesprekken, e-mails, notities en afspraken van het contact. "Toon alle" laat de rest zien.',
        '"Bellen" belt de klant direct via Aircall. "Contact in HubSpot ↗" naast de naam opent het contact in HubSpot.',
        'Je kunt het venster verslepen aan de kop en groter of kleiner maken met de hoek rechtsonder.',
        'Onderaan staan de knoppen om de lead af te ronden: Home Visit, Schedule Videocall, Long Term, Taak en Lost.',
      ],
      en: [
        'On the left is everything about the customer: Lead info, Configurator & notes, Recent activity, Customer\'s other leads and the Call outcome. The playbook is on the right.',
        'Recent activity shows the contact\'s calls, emails, notes and meetings. "Show all" shows the rest.',
        '"Call" calls the customer straight away through Aircall. "Contact in HubSpot ↗" next to the name opens the contact in HubSpot.',
        'Drag the window by its header, and resize it from the bottom-right corner.',
        'The buttons at the bottom close out the lead: Home Visit, Schedule Videocall, Long Term, Task and Lost.',
      ],
    },
  },
  {
    id: 'configurator', group: 'lead', clip: 'configurator',
    title: { nl: '🧾 Configurator & notities', en: '🧾 Configurator & notes' },
    steps: {
      nl: [
        'Klik op "Configurator & notities" om het blok te openen.',
        'Je ziet wat de klant op de website heeft ingevuld: de besparingscheck, de geaccepteerde self-service offerte of de offerte uit de configurator.',
        'Daaronder staan de notities van collega\'s. Elke notitie begint met een grijze kop met datum en tijd.',
        'Je kunt hier niets wijzigen. Staat er "(leeg)" achter de titel, dan is er niets ingevuld.',
      ],
      en: [
        'Click "Configurator & notes" to open the block.',
        'You see what the customer filled in on the website: the savings check, the accepted self-service quote or the configurator quote.',
        'Below that are your colleagues\' notes. Each note starts with a grey header with the date and time.',
        'Nothing can be changed here. "(empty)" after the title means nothing has been filled in.',
      ],
    },
  },
  {
    id: 'contact-details', group: 'lead', clip: 'contact-details',
    title: { nl: '✉️ E-mail of telefoonnummer aanpassen', en: '✉️ Changing the email or phone number' },
    steps: {
      nl: [
        'Klik onder Lead informatie op E-mail of Telefoon.',
        'Bij telefoon kies je eerst het land (standaard NL; typ de eerste letters om naar een land te springen) en typ je het nummer zoals de klant het zegt, bijvoorbeeld 06 12345678. Het wordt opgeslagen als +31612345678.',
        'Druk op Enter of klik ernaast om op te slaan. Esc annuleert. De wijziging gaat direct naar het contact in HubSpot.',
        'Wijzig het e-mailadres nooit in de planner: dan maakt HubSpot een dubbel contact aan dat niet aan de lead of deal hangt.',
        'Hoort het e-mailadres al bij een ander contact? Dan zie je dat contact in een pop-up. Is het dezelfde klant, kies dan "Ja, koppel de lead aan dit contact". Het oude contact blijft in HubSpot staan.',
      ],
      en: [
        'Under Lead info, click Email or Phone.',
        'For the phone, pick the country first (NL by default; type the first letters to jump to a country) and type the number the way the customer says it, e.g. 06 12345678. It is saved as +31612345678.',
        'Press Enter or click elsewhere to save. Esc cancels. The change goes straight to the contact in HubSpot.',
        'Never change the email in the scheduler: HubSpot then creates a duplicate contact that is not linked to the lead or deal.',
        'Does the email already belong to another contact? A popup shows that contact. If it is the same customer, choose "Yes, link the lead to this contact". The old contact stays in HubSpot.',
      ],
    },
  },
  {
    id: 'call-outcome', group: 'lead', clip: 'call-outcome',
    title: { nl: '📞 Call outcome invullen', en: '📞 Setting the call outcome' },
    steps: {
      nl: [
        'Kies na elk gesprek de uitkomst in de Call outcome-dropdown in de linkerkolom, bijvoorbeeld "Did not pick up 1x" of "Handled".',
        'De uitkomst wordt direct in HubSpot opgeslagen.',
        'Je notities uit het playbook worden op dat moment ook opgeslagen (zie Playbook invullen).',
      ],
      en: [
        'After every call, pick the outcome in the Call outcome dropdown in the left column, e.g. "Did not pick up 1x" or "Handled".',
        'The outcome is saved to HubSpot straight away.',
        'Your playbook notes are saved at that moment too (see Filling in the playbook).',
      ],
    },
  },
  {
    id: 'playbook', group: 'lead', clip: 'playbook',
    title: { nl: '📝 Playbook invullen', en: '📝 Filling in the playbook' },
    steps: {
      nl: [
        'Het playbook staat in de rechterkolom en past bij het product van de lead.',
        'Loop de fases door met de pijlen of "Volgende fase →". Lees het script voor en beantwoord de vragen.',
        'Een antwoord op een open vraag of keuzevraag komt als regel bij de notities van de lead in HubSpot. Open tekst wordt opgeslagen als je naast het veld klikt; bij meerdere keuzes klik je op "Opslaan".',
        'Vragen die een HubSpot-veld bijwerken (zoals het woningtype) slaan direct op in dat veld.',
        'Wat je in de notitievelden typt, wordt als één blok met datum en tijd bij de notities gezet zodra je een Call outcome kiest, een afspraak plant, of de lead op Long Term of Lost zet.',
      ],
      en: [
        'The playbook is in the right column and matches the lead\'s product.',
        'Go through the phases with the arrows or "Next phase →". Read the script and answer the questions.',
        'An answer to an open or choice question is added as a line to the lead\'s notes in HubSpot. Open text is saved when you click outside the field; for multiple choice, click "Save".',
        'Questions that update a HubSpot field (such as the house type) save straight to that field.',
        'What you type in the note fields is added to the notes as one block with date and time as soon as you pick a Call outcome, book an appointment, or set the lead to Long Term or Lost.',
      ],
    },
  },
  {
    id: 'other-leads', group: 'lead', clip: 'other-leads',
    title: { nl: '👥 Andere leads van de klant', en: '👥 The customer\'s other leads' },
    steps: {
      nl: [
        'Heeft de klant nog andere actieve leads (bijvoorbeeld voor een ander product), dan staat het aantal oranje bij "Andere leads van klant". Klik erop om ze te zien.',
        '"Claimen" zet een lead op jouw naam, zet hem op MQL en opent hem. Is de lead van een collega, dan vraagt de tool eerst of je hem wilt overnemen.',
        'Eneco-leads staan er alleen ter info.',
        'Na Home Visit, Schedule Videocall, Long Term of Lost vraagt een pop-up wat er met de andere leads moet gebeuren: Open laten (verandert niets), Lost, Long Term Opportunity of Send Configurator Link. Klik op "Opslaan".',
      ],
      en: [
        'If the customer has other active leads (for another product, say), the count shows in orange next to "Customer\'s other leads". Click it to see them.',
        '"Claim" assigns a lead to you, moves it to MQL and opens it. If the lead belongs to a colleague, the tool first asks whether you want to take it over.',
        'Eneco leads are shown for information only.',
        'After Home Visit, Schedule Videocall, Long Term or Lost, a popup asks what to do with the other leads: Leave open (changes nothing), Lost, Long Term Opportunity or Send Configurator Link. Click "Save".',
      ],
    },
  },
  {
    id: 'warnings', group: 'lead', clip: 'warnings',
    title: { nl: '⚠️ Waarschuwingen in het lead-scherm', en: '⚠️ Warnings in the lead screen' },
    steps: {
      nl: [
        'Oranje balk "Klant heeft al een actieve deal bij een TAM": plan de afspraak met dezelfde TAM. De klant wil één aanspreekpunt. Bij Home Visit en Schedule Videocall vraagt de tool je dit eerst te bevestigen.',
        'Balk "Directe afspraak al gepland" (VEH-leads): de klant heeft al een directe afspraak. Wil de klant de VEH-prijzen vergelijken, plan dan een VEH-afspraak en zet de lead niet op Lost. Lost kan pas als je aanvinkt dat de klant het VEH-aanbod zeker niet wil.',
        'Is de lead al SQL (omgezet naar een deal), dan is alles vergrendeld en kun je niets meer wijzigen.',
        'Heeft de lead alleen Chill als product, dan is Home Visit uitgeschakeld.',
      ],
      en: [
        'Orange banner "Customer already has an active deal with a TAM": book the appointment with the same TAM. The customer wants one point of contact. Home Visit and Schedule Videocall ask you to confirm this first.',
        'Banner "Direct appointment already booked" (VEH leads): the customer already has a direct appointment. If they want to compare VEH prices, book a VEH appointment and don\'t set the lead to Lost. Lost only works once you tick that the customer definitely doesn\'t want the VEH offer.',
        'If the lead is already SQL (converted to a deal), everything is locked and nothing can be changed.',
        'If the lead\'s only product is Chill, Home Visit is disabled.',
      ],
    },
  },

  // ── Booking and closing ─────────────────────────────────────────────────────
  {
    id: 'home-visit', group: 'booking', clip: 'home-visit',
    title: { nl: '🏠 Huisbezoek plannen (Home Visit)', en: '🏠 Booking a home visit (Home Visit)' },
    steps: {
      nl: [
        'Controleer het adres: postcode en huisnummer zijn verplicht, en vul een toevoeging in als die er is. Straat en woonplaats worden automatisch aangevuld.',
        'Klik op "Home Visit". De tool zet de lead op Plan HV en HubSpot maakt een deal aan. Dat duurt even; je ziet "Afspraak boeken…".',
        'Daarna verschijnt onderaan "Deal aangemaakt in Consumer Orders" met de link "Open planner". Plan daar het huisbezoek.',
        'Ook een Long Term-lead kun je zo boeken: de tool zet hem eerst terug naar MQL. Dat kan tot een minuut duren.',
      ],
      en: [
        'Check the address: postcode and house number are required, and add a suffix if there is one. Street and city are filled in automatically.',
        'Click "Home Visit". The tool sets the lead to Plan HV and HubSpot creates a deal. That takes a moment; you see "Booking appointment…".',
        'Then "Deal created in Consumer Orders" appears at the bottom with the "Open scheduler" link. Book the home visit there.',
        'A Long Term lead can be booked the same way: the tool moves it back to MQL first. That can take up to a minute.',
      ],
    },
  },
  {
    id: 'videocall', group: 'booking', clip: 'videocall',
    title: { nl: '🎥 Videocall plannen', en: '🎥 Booking a video call' },
    steps: {
      nl: [
        'Klik op "Schedule Videocall" (per product kan de knop anders heten, bijvoorbeeld "Adviesgesprek plannen"). De HubSpot-planner opent met de gegevens van de klant al ingevuld.',
        'Kies een tijd en boek de afspraak. Klopt het e-mailadres niet? Pas het dan aan bij Lead informatie, niet in de planner.',
        'Zodra de afspraak geboekt is, zet de tool de lead op Plan Call en maakt HubSpot een deal aan.',
        'Geboekt via "Openen in nieuw tabblad →"? Sluit dan het venster en klik op "Ja" bij "Heb je een afspraak kunnen maken met de klant?".',
      ],
      en: [
        'Click "Schedule Videocall" (the button can have another name per product, e.g. "Adviesgesprek plannen"). The HubSpot scheduler opens with the customer\'s details filled in.',
        'Pick a time and book the appointment. Is the email wrong? Change it under Lead info, not in the scheduler.',
        'As soon as the appointment is booked, the tool sets the lead to Plan Call and HubSpot creates a deal.',
        'Booked through "Open in new tab →"? Then close the window and click "Yes" when the tool asks whether you managed to book an appointment.',
      ],
    },
  },
  {
    id: 'long-term', group: 'booking', clip: 'long-term',
    title: { nl: '⏳ Lead op Long Term zetten', en: '⏳ Setting a lead to Long Term' },
    steps: {
      nl: [
        'Wil de klant wel, maar nu nog niet? Klik op "Long Term".',
        'Kies wanneer je de klant opnieuw benadert: +1 maand, +2 maanden of zelf een datum kiezen.',
        'Schrijf de reden op (minimaal 10 tekens), bijvoorbeeld "wacht op offerte dakisolatie".',
        'Controleer de taak voor jezelf en klik op "Opslaan en op Long Term zetten". De taak is verplicht: zo komt de lead op de gekozen datum bij je terug.',
        'Long Term-leads en hun taken vind je onder Taken, filter "Long Term".',
      ],
      en: [
        'The customer is interested, but not yet? Click "Long Term".',
        'Pick when to contact the customer again: +1 month, +2 months, or pick a date.',
        'Write down the reason (at least 10 characters), e.g. "waiting for a roof insulation quote".',
        'Check the task for yourself and click "Save and set Long Term". The task is required: it brings the lead back to you on the chosen date.',
        'Long Term leads and their tasks are under Tasks, filter "Long Term".',
      ],
    },
  },
  {
    id: 'lost', group: 'booking', clip: 'lost',
    title: { nl: '✖️ Lead op Lost zetten', en: '✖️ Setting a lead to Lost' },
    steps: {
      nl: [
        'Klik op "Lost" onderaan het lead-scherm.',
        'Kies de reden.',
        'Klik op "Bevestigen". De lead gaat naar Lost en verdwijnt van je bord.',
        'Is de klant niet bereikbaar maar nog wel geïnteresseerd? Kies dan liever Long Term.',
      ],
      en: [
        'Click "Lost" at the bottom of the lead screen.',
        'Pick the reason.',
        'Click "Confirm". The lead moves to Lost and leaves your board.',
        'Customer unreachable but still interested? Choose Long Term instead.',
      ],
    },
  },

  // ── Tasks ───────────────────────────────────────────────────────────────────
  {
    id: 'tasks', group: 'tasks', clip: 'tasks',
    title: { nl: '✅ Werken met taken', en: '✅ Working with tasks' },
    steps: {
      nl: [
        'Klik op het tabblad "Taken". Je ziet je openstaande taken uit HubSpot. Filter met Alle, MQL of Long Term.',
        'Klik op "+ Nieuwe taak", of op "Taak" onderaan het lead-scherm. Vul de taak en een deadline in (leeg = vandaag) en kies de lead.',
        'In het lead-scherm staan je taken voor die lead onder "Jouw openstaande taken".',
        '"✓ Afgerond" sluit een taak. Met "Bewerken" pas je hem aan; "In HubSpot ↗" opent hem in HubSpot.',
      ],
      en: [
        'Click the "Tasks" tab. You see your open tasks from HubSpot. Filter with All, MQL or Long Term.',
        'Click "+ New task", or "Task" at the bottom of the lead screen. Enter the task and a deadline (empty = today) and pick the lead.',
        'In the lead screen, your tasks for that lead are under "Your open tasks".',
        '"✓ Complete" closes a task. "Edit" changes it; "In HubSpot ↗" opens it in HubSpot.',
      ],
    },
  },
  {
    id: 'handover', group: 'tasks', clip: 'handover',
    title: { nl: '🤝 Een lead overdragen aan een collega', en: '🤝 Handing a lead over to a colleague' },
    steps: {
      nl: [
        'Maak een taak voor de lead en kies bij "Toegewezen aan" je collega.',
        'Je collega ziet de taak onder Taken, met de knop "Overnemen". Daarmee komt de lead op zijn of haar naam en bord.',
        'Heb jij zo\'n taak gekregen? Klik op "Overnemen" om de lead op te pakken.',
      ],
      en: [
        'Create a task for the lead and pick your colleague under "Assigned to".',
        'Your colleague sees the task under Tasks, with an "Accept" button. That moves the lead to their name and board.',
        'Got such a task yourself? Click "Accept" to pick up the lead.',
      ],
    },
  },

  // ── Other ───────────────────────────────────────────────────────────────────
  {
    id: 'new-version', group: 'other',
    title: { nl: '🔄 "Nieuwe versie beschikbaar"', en: '🔄 "New version available"' },
    steps: {
      nl: [
        'Is er een nieuwe versie van de tool, dan verschijnt bovenaan een oranje balk.',
        'Herlaad de pagina als je klaar bent met de lead waar je mee bezig bent. Daarna heb je de nieuwe functies.',
      ],
      en: [
        'When a new version of the tool is out, an orange banner appears at the top.',
        'Reload the page once you\'re done with the lead you\'re working on. You then have the new features.',
      ],
    },
  },
  {
    id: 'feedback', group: 'other',
    title: { nl: '💬 Feedback geven', en: '💬 Giving feedback' },
    steps: {
      nl: [
        'Klik op "💬 Help/Feedback" rechtsboven en kies het tabblad "Feedback".',
        'Beschrijf de bug of het idee zo precies mogelijk (welke lead, wat je deed, wat er gebeurde) en klik op "Verstuur feedback".',
      ],
      en: [
        'Click "💬 Help/Feedback" at the top right and pick the "Feedback" tab.',
        'Describe the bug or idea as precisely as you can (which lead, what you did, what happened) and click "Submit feedback".',
      ],
    },
  },
  {
    id: 'settings', group: 'other',
    title: { nl: '🌙 Taal en thema', en: '🌙 Language and theme' },
    steps: {
      nl: [
        'NL / EN rechtsboven wisselt de taal.',
        '🌙 / ☀️ wisselt tussen licht en donker.',
      ],
      en: [
        'NL / EN at the top right switches the language.',
        '🌙 / ☀️ switches between light and dark.',
      ],
    },
  },

  // ── Admin ───────────────────────────────────────────────────────────────────
  {
    id: 'admin-playbooks', group: 'admin', adminOnly: true,
    title: { nl: '🛠 Playbooks beheren', en: '🛠 Managing playbooks' },
    steps: {
      nl: [
        'Ga naar "⚙ Admin" rechtsboven, tabblad Playbooks.',
        'Klik op "+ Nieuw playbook", geef het een naam en de productmatch (leads met die tekst in het product krijgen dit playbook).',
        'Voeg fases toe met "+ Fase toevoegen" en vragen met "+ Vraag toevoegen". Open tekst en keuzevragen komen bij de notities van de lead; "Update property" schrijft naar een HubSpot-veld.',
        'Klik op "Playbook opslaan". Reps zien de wijziging na opnieuw inloggen.',
      ],
      en: [
        'Go to "⚙ Admin" at the top right, Playbooks tab.',
        'Click "+ New playbook", give it a name and the product match (leads with that text in their product get this playbook).',
        'Add phases with "+ Add phase" and questions with "+ Add question". Open text and choice questions go to the lead\'s notes; "Update property" writes to a HubSpot field.',
        'Click "Save playbook". Reps see the change after signing in again.',
      ],
    },
  },
  {
    id: 'admin-schedulers', group: 'admin', adminOnly: true,
    title: { nl: '🗓 Schedulers koppelen', en: '🗓 Connecting schedulers' },
    steps: {
      nl: [
        'Ga naar Admin, tabblad Schedulers, en klik op "+ Nieuwe scheduler".',
        'Vul de naam, de knoptekst en de HubSpot Meetings URL in.',
        'Vul de productmatch in (leeg = voor alle leads) en klik op "Scheduler opslaan".',
      ],
      en: [
        'Go to Admin, Schedulers tab, and click "+ New scheduler".',
        'Enter the name, the button label and the HubSpot Meetings URL.',
        'Enter the product match (empty = all leads) and click "Save scheduler".',
      ],
    },
  },
  {
    id: 'admin-team', group: 'admin', adminOnly: true,
    title: { nl: '📈 Teamprestaties', en: '📈 Team performance' },
    steps: {
      nl: [
        'Ga naar Admin, tabblad "📈 Teamprestaties".',
        'Kies een periode (vandaag tot 6 maanden, of aangepast). Je ziet verwerkte leads, SQL, Long Term, Lost, de gemiddelde verwerkingstijd in werkuren en de open taken.',
        'Klik op een naam onder "Per teamlid" voor de cijfers van die persoon.',
        'De eerste keer laden van een lange periode kan een minuut duren.',
      ],
      en: [
        'Go to Admin, "📈 Team performance" tab.',
        'Pick a period (today up to 6 months, or custom). You see leads processed, SQL, Long Term, Lost, the average time to process in working hours and the open tasks.',
        'Click a name under "Per team member" for that person\'s numbers.',
        'The first load of a long period can take a minute.',
      ],
    },
  },
  {
    id: 'admin-feedback', group: 'admin', adminOnly: true,
    title: { nl: '💬 Feedback beheren', en: '💬 Managing feedback' },
    steps: {
      nl: [
        'Ga naar Admin, tabblad Feedback. Je ziet alle feedback van de reps.',
        'Geef elk bericht een status (Open, In behandeling, Klaar, Wordt niet gedaan) en filter op status.',
      ],
      en: [
        'Go to Admin, Feedback tab. You see all feedback from the reps.',
        'Give each entry a status (Open, In progress, Done, Won\'t do) and filter by status.',
      ],
    },
  },
  {
    id: 'admin-restore', group: 'admin', adminOnly: true,
    title: { nl: '↩️ Lead terugzetten uit Lost', en: '↩️ Restoring a lead from Lost' },
    steps: {
      nl: [
        'Open de Lost-lead (via Alle leads) en klik onderaan op "Terugzetten uit Lost".',
        'Bevestig. De lead gaat terug naar MQL; het call-resultaat, de lost-reden en de call outcome worden gewist.',
      ],
      en: [
        'Open the Lost lead (through All leads) and click "Restore from Lost" at the bottom.',
        'Confirm. The lead goes back to MQL; the call result, lost reason and call outcome are cleared.',
      ],
    },
  },
]

// ── Quick start guide ─────────────────────────────────────────────────────────
// Shown once per email address on the first login (see /api/onboarding), and
// any time from Help. Clips are shared with the topics above.

export interface QuickStartStep {
  id: string
  clip?: string
  title: Text
  body: Text
}

export const QUICK_START_STEPS: QuickStartStep[] = [
  {
    id: 'welcome', clip: 'board',
    title: { nl: 'Welkom bij de Sales Support Tool 👋', en: 'Welcome to the Sales Support Tool 👋' },
    body: {
      nl: 'Hier bel je je leads, vul je het playbook in en plan je afspraken. Alles wat je doet, gaat direct naar HubSpot. In een paar stappen laten we je de basis zien.',
      en: 'This is where you call your leads, fill in the playbook and book appointments. Everything you do goes straight to HubSpot. A few steps show you the basics.',
    },
  },
  {
    id: 'request', clip: 'request-leads',
    title: { nl: 'Leads aanvragen', en: 'Request leads' },
    body: {
      nl: 'Klik op "Leads aanvragen". Na een paar seconden staan je nieuwe leads op je bord. Daarna kun je na 60 seconden opnieuw aanvragen.',
      en: 'Click "Request Leads". After a few seconds your new leads are on your board. You can request again after 60 seconds.',
    },
  },
  {
    id: 'lead', clip: 'lead-screen',
    title: { nl: 'Een lead openen', en: 'Open a lead' },
    body: {
      nl: 'Klik op een lead. Links zie je alles over de klant: gegevens, wat de klant in de configurator koos, recente activiteit en eventuele andere leads. Rechts staat het playbook.',
      en: 'Click a lead. On the left you see everything about the customer: details, what they chose in the configurator, recent activity and any other leads. The playbook is on the right.',
    },
  },
  {
    id: 'call', clip: 'playbook',
    title: { nl: 'Bellen en het playbook', en: 'Calling and the playbook' },
    body: {
      nl: 'Bel met "Bellen", loop het playbook door en kies na het gesprek de Call outcome. Antwoorden en notities worden in HubSpot bij de lead opgeslagen.',
      en: 'Call with "Call", go through the playbook and pick the Call outcome after the call. Answers and notes are saved on the lead in HubSpot.',
    },
  },
  {
    id: 'book', clip: 'home-visit',
    title: { nl: 'Een afspraak plannen', en: 'Book an appointment' },
    body: {
      nl: 'Klik op "Home Visit" voor een huisbezoek of "Schedule Videocall" voor een videocall. HubSpot maakt de deal aan en je krijgt de link naar de planner.',
      en: 'Click "Home Visit" for a home visit or "Schedule Videocall" for a video call. HubSpot creates the deal and you get the link to the scheduler.',
    },
  },
  {
    id: 'close', clip: 'long-term',
    title: { nl: 'Nog niet, of helemaal niet?', en: 'Not yet, or not at all?' },
    body: {
      nl: 'Wil de klant later? Zet de lead op "Long Term" met een datum en reden; je krijgt dan een taak om terug te bellen. Wil de klant niet? Kies "Lost" met een reden.',
      en: 'Customer wants to wait? Set the lead to "Long Term" with a date and reason; you get a task to call back. Customer not interested? Choose "Lost" with a reason.',
    },
  },
  {
    id: 'tasks', clip: 'tasks',
    title: { nl: 'Taken', en: 'Tasks' },
    body: {
      nl: 'Onder "Taken" staan je openstaande taken. Maak een taak voor een lead, wijs hem toe aan jezelf of een collega en vink hem af als hij klaar is.',
      en: 'Your open tasks are under "Tasks". Create a task for a lead, assign it to yourself or a colleague, and tick it off when it\'s done.',
    },
  },
  {
    id: 'help',
    title: { nl: 'Hulp nodig?', en: 'Need help?' },
    body: {
      nl: 'Klik op "💬 Help/Feedback" rechtsboven. Daar vind je de handleiding met korte video\'s per onderdeel, kun je feedback geven en deze snelstartgids opnieuw bekijken.',
      en: 'Click "💬 Help/Feedback" at the top right. There you\'ll find the manual with a short video for each feature, you can send feedback, and you can view this quick start guide again.',
    },
  },
]
