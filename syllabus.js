// Generated from the NAS version's app/syllabus.py: IMA urological surgery syllabus 2022 v2.0.
// Targets, procedure weights (which marked procedure an operation counts as) and companions.
export const SYLLABUS = {
 "name": "Urological surgery syllabus 2022, version 2.0",
 "child_age_limit": 18,
 "groups": {
  "urology": {
   "en": "Urology",
   "he": "כירורגיה אורולוגית"
  },
  "general": {
   "en": "General surgery rotation",
   "he": "כירורגיה כללית"
  }
 },
 "categories": [
  {
   "key": "bph",
   "group": "urology",
   "weight": 60,
   "en": "BPH surgery",
   "he": "ניתוחים לטיפול ב-BPH",
   "detail": "ניתוחים אנדוסקופיים ופתוחים",
   "total": 60,
   "primary": 40
  },
  {
   "key": "prostate_bx",
   "group": "urology",
   "weight": 30,
   "en": "Prostate biopsy",
   "he": "ביופסיית ערמונית",
   "detail": "בגישות שונות",
   "total": 15,
   "primary": 10
  },
  {
   "key": "pelvic",
   "group": "urology",
   "weight": 100,
   "en": "Major pelvic surgery",
   "he": "ניתוחים גדולים באגן",
   "detail": "radical prostatectomy, radical cystectomy, exstrophy stage 2 and up, pelvic exenteration; בגישות שונות",
   "total": 15,
   "primary": 7
  },
  {
   "key": "kidney",
   "group": "urology",
   "weight": 90,
   "en": "Kidney and adrenal",
   "he": "ניתוחי כליה ואדרנל",
   "detail": "בגישות שונות; מתוכם 10 בגישה לפרוסקופית או לפרוסקופית רובוטית",
   "total": 30,
   "primary": 15,
   "sub": [
    {
     "kind": "minimally_invasive",
     "n": 10,
     "en": "laparoscopic or robotic",
     "he": "בגישה לפרוסקופית / רובוטית"
    }
   ]
  },
  {
   "key": "ureter",
   "group": "urology",
   "weight": 80,
   "en": "Ureter",
   "he": "ניתוחי שופכן",
   "detail": "כל טיפול כירורגי בשופכן, לרבות טיפול אנדוסקופי ברפלוקס והתערבויות שחזוריות לרבות פיאלופלסטיקה",
   "total": 10,
   "primary": 5
  },
  {
   "key": "turbt",
   "group": "urology",
   "weight": 45,
   "en": "TURBT and bladder biopsy",
   "he": "TURBT",
   "detail": "לרבות ביופסיות מכיס השתן בגישות שונות",
   "total": 50,
   "primary": 30
  },
  {
   "key": "cysto",
   "group": "urology",
   "weight": 20,
   "en": "Cystoscopy",
   "he": "ציסטוסקופיה",
   "detail": "אבחנתית או טיפולית",
   "total": 300,
   "primary": 250
  },
  {
   "key": "spc",
   "group": "urology",
   "weight": 25,
   "en": "Suprapubic cystostomy",
   "he": "הכנסת ציסטוסטום",
   "detail": "",
   "total": 7,
   "primary": 5
  },
  {
   "key": "urethra",
   "group": "urology",
   "weight": 50,
   "en": "Urethra",
   "he": "ניתוחי שופכה",
   "detail": "לרבות מאטוטומי, urethroplasty, urethrectomy והרחבת שופכה; בגישות שונות",
   "total": 40,
   "primary": 28
  },
  {
   "key": "scrotal",
   "group": "urology",
   "weight": 50,
   "en": "Groin, testis and scrotum",
   "he": "מפשעה, אשכים ושק האשכים",
   "detail": "כריתת אשך, השתלת אשך תותב, תיקוני הידרוצל ווריקוצל, קיבוע אשכים, טיפול במצבים חריפים; מתוכם 10 בילדים",
   "total": 60,
   "primary": 45,
   "sub": [
    {
     "kind": "children",
     "n": 10,
     "en": "in children",
     "he": "בילדים"
    }
   ]
  },
  {
   "key": "penis",
   "group": "urology",
   "weight": 55,
   "en": "Penis",
   "he": "ניתוחי הפין",
   "detail": "עקמת, טראומה, השתלת תותב פין, ניתוחים לפריאפיזם, מילה, penectomy והיפוספדיאס; מתוכם 5 בילדים",
   "total": 40,
   "primary": 20,
   "sub": [
    {
     "kind": "children",
     "n": 5,
     "en": "in children",
     "he": "בילדים"
    }
   ]
  },
  {
   "key": "pcnl",
   "group": "urology",
   "weight": 75,
   "en": "PCNL",
   "he": "PCNL",
   "detail": "טיפול באבנים ואורולוגיה זעיר פולשנית",
   "total": 15,
   "primary": 0
  },
  {
   "key": "eswl",
   "group": "urology",
   "weight": 35,
   "en": "ESWL",
   "he": "ESWL",
   "detail": "טיפול באבנים ואורולוגיה זעיר פולשנית",
   "total": 5,
   "primary": 0
  },
  {
   "key": "urs",
   "group": "urology",
   "weight": 50,
   "en": "Ureteroscopy incl. RIRS",
   "he": "אורטרוסקופיה",
   "detail": "דיאגנוסטית וטיפולית לרבות RIRS",
   "total": 50,
   "primary": 25
  },
  {
   "key": "stent",
   "group": "urology",
   "weight": 30,
   "en": "Ureteral stent insertion",
   "he": "הכנסת צנתר לשופכן",
   "detail": "צנתר מסוגים שונים",
   "total": 40,
   "primary": 30
  },
  {
   "key": "female",
   "group": "urology",
   "weight": 60,
   "en": "Female urology and pelvic floor",
   "he": "Female Urology ורצפת האגן",
   "detail": "ניתוחים ופעולות זעיר פולשניות באי נקיטת שתן בנשים ובגברים, לרבות ניתוחים שחזוריים של רצפת האגן",
   "total": 10,
   "primary": 0
  },
  {
   "key": "uds",
   "group": "urology",
   "weight": 10,
   "en": "Urodynamic study",
   "he": "תבחין אורודינמי",
   "detail": "בגישות ואמצעים שונים",
   "total": 20,
   "primary": 15
  },
  {
   "key": "gs_groin",
   "group": "general",
   "weight": 50,
   "en": "Groin and testis (general surgery)",
   "he": "ניתוחים באזור המפשעה והאשך",
   "detail": "ברוטציה בכירורגיה כללית; מתוכם 20 כמנתח ראשון",
   "total": 25,
   "primary": 20
  },
  {
   "key": "gs_abdomen",
   "group": "general",
   "weight": 85,
   "en": "Abdominal surgery (general surgery)",
   "he": "ניתוחים בחלל הבטן",
   "detail": "ברוטציה בכירורגיה כללית; בחלקם השקות מעי; מתוכם 5 כמנתח ראשון",
   "total": 15,
   "primary": 5
  }
 ],
 "presets": [
  {
   "name": "TURP",
   "category": "bph",
   "approach": "endo",
   "weight": 60
  },
  {
   "name": "HoLEP",
   "category": "bph",
   "approach": "endo",
   "weight": 65
  },
  {
   "name": "ThuLEP",
   "category": "bph",
   "approach": "endo",
   "weight": 65
  },
  {
   "name": "Laser vaporization of prostate (PVP)",
   "category": "bph",
   "approach": "endo",
   "weight": 55
  },
  {
   "name": "TUIP",
   "category": "bph",
   "approach": "endo",
   "weight": 50
  },
  {
   "name": "Simple prostatectomy, open",
   "category": "bph",
   "approach": "open",
   "weight": 85
  },
  {
   "name": "Simple prostatectomy, robotic",
   "category": "bph",
   "approach": "robotic",
   "weight": 85
  },
  {
   "name": "Transperineal prostate biopsy",
   "category": "prostate_bx",
   "approach": "",
   "weight": 30
  },
  {
   "name": "Transrectal prostate biopsy",
   "category": "prostate_bx",
   "approach": "",
   "weight": 30
  },
  {
   "name": "MRI-fusion prostate biopsy",
   "category": "prostate_bx",
   "approach": "",
   "weight": 30
  },
  {
   "name": "Radical prostatectomy, robotic",
   "category": "pelvic",
   "approach": "robotic",
   "weight": 100
  },
  {
   "name": "Radical prostatectomy, open",
   "category": "pelvic",
   "approach": "open",
   "weight": 100
  },
  {
   "name": "Radical cystectomy",
   "category": "pelvic",
   "approach": "open",
   "weight": 100
  },
  {
   "name": "Radical cystectomy, robotic",
   "category": "pelvic",
   "approach": "robotic",
   "weight": 100
  },
  {
   "name": "Pelvic exenteration",
   "category": "pelvic",
   "approach": "open",
   "weight": 100
  },
  {
   "name": "Exstrophy repair (stage 2+)",
   "category": "pelvic",
   "approach": "open",
   "weight": 100
  },
  {
   "name": "Radical nephrectomy",
   "category": "kidney",
   "approach": "lap",
   "weight": 92
  },
  {
   "name": "Partial nephrectomy",
   "category": "kidney",
   "approach": "robotic",
   "weight": 95
  },
  {
   "name": "Simple nephrectomy",
   "category": "kidney",
   "approach": "lap",
   "weight": 88
  },
  {
   "name": "Nephroureterectomy",
   "category": "kidney",
   "approach": "lap",
   "weight": 95
  },
  {
   "name": "Adrenalectomy",
   "category": "kidney",
   "approach": "lap",
   "weight": 90
  },
  {
   "name": "Renal cyst decortication",
   "category": "kidney",
   "approach": "lap",
   "weight": 70
  },
  {
   "name": "Pyeloplasty",
   "category": "ureter",
   "approach": "robotic",
   "weight": 85
  },
  {
   "name": "Ureteral reimplantation",
   "category": "ureter",
   "approach": "open",
   "weight": 85
  },
  {
   "name": "Endoscopic reflux injection",
   "category": "ureter",
   "approach": "endo",
   "weight": 40
  },
  {
   "name": "Ureteroureterostomy",
   "category": "ureter",
   "approach": "open",
   "weight": 85
  },
  {
   "name": "Psoas hitch / Boari flap",
   "category": "ureter",
   "approach": "open",
   "weight": 88
  },
  {
   "name": "TURBT",
   "category": "turbt",
   "approach": "endo",
   "weight": 45
  },
  {
   "name": "Bladder biopsy",
   "category": "turbt",
   "approach": "endo",
   "weight": 35
  },
  {
   "name": "Cystoscopy, flexible",
   "category": "cysto",
   "approach": "endo",
   "weight": 10
  },
  {
   "name": "Cystoscopy, rigid",
   "category": "cysto",
   "approach": "endo",
   "weight": 15
  },
  {
   "name": "Cystoscopy + retrograde pyelogram",
   "category": "cysto",
   "approach": "endo",
   "weight": 20
  },
  {
   "name": "Cystolitholapaxy",
   "category": "cysto",
   "approach": "endo",
   "weight": 38
  },
  {
   "name": "Intravesical Botox",
   "category": "cysto",
   "approach": "endo",
   "weight": 25
  },
  {
   "name": "Cystoscopic stent removal",
   "category": "cysto",
   "approach": "endo",
   "weight": 12
  },
  {
   "name": "Suprapubic catheter insertion",
   "category": "spc",
   "approach": "perc",
   "weight": 25
  },
  {
   "name": "Meatotomy",
   "category": "urethra",
   "approach": "open",
   "weight": 25
  },
  {
   "name": "Urethral dilation",
   "category": "urethra",
   "approach": "endo",
   "weight": 15
  },
  {
   "name": "Optical urethrotomy (DVIU)",
   "category": "urethra",
   "approach": "endo",
   "weight": 40
  },
  {
   "name": "Urethroplasty",
   "category": "urethra",
   "approach": "open",
   "weight": 80
  },
  {
   "name": "Urethrectomy",
   "category": "urethra",
   "approach": "open",
   "weight": 75
  },
  {
   "name": "Radical orchiectomy",
   "category": "scrotal",
   "approach": "open",
   "weight": 55
  },
  {
   "name": "Simple orchiectomy",
   "category": "scrotal",
   "approach": "open",
   "weight": 45
  },
  {
   "name": "Testicular prosthesis",
   "category": "scrotal",
   "approach": "open",
   "weight": 42
  },
  {
   "name": "Hydrocelectomy",
   "category": "scrotal",
   "approach": "open",
   "weight": 45
  },
  {
   "name": "Varicocelectomy",
   "category": "scrotal",
   "approach": "open",
   "weight": 48
  },
  {
   "name": "Orchiopexy",
   "category": "scrotal",
   "approach": "open",
   "weight": 50
  },
  {
   "name": "Scrotal exploration",
   "category": "scrotal",
   "approach": "open",
   "weight": 50
  },
  {
   "name": "Spermatocelectomy",
   "category": "scrotal",
   "approach": "open",
   "weight": 44
  },
  {
   "name": "Circumcision",
   "category": "penis",
   "approach": "open",
   "weight": 30
  },
  {
   "name": "Hypospadias repair",
   "category": "penis",
   "approach": "open",
   "weight": 70
  },
  {
   "name": "Penile prosthesis",
   "category": "penis",
   "approach": "open",
   "weight": 75
  },
  {
   "name": "Penile plication (Peyronie's)",
   "category": "penis",
   "approach": "open",
   "weight": 60
  },
  {
   "name": "Priapism shunt",
   "category": "penis",
   "approach": "open",
   "weight": 55
  },
  {
   "name": "Penile fracture repair",
   "category": "penis",
   "approach": "open",
   "weight": 60
  },
  {
   "name": "Penectomy",
   "category": "penis",
   "approach": "open",
   "weight": 70
  },
  {
   "name": "PCNL",
   "category": "pcnl",
   "approach": "perc",
   "weight": 78
  },
  {
   "name": "Mini-PCNL",
   "category": "pcnl",
   "approach": "perc",
   "weight": 76
  },
  {
   "name": "ECIRS",
   "category": "pcnl",
   "approach": "perc",
   "weight": 80
  },
  {
   "name": "ESWL",
   "category": "eswl",
   "approach": "",
   "weight": 35
  },
  {
   "name": "Ureteroscopy, diagnostic",
   "category": "urs",
   "approach": "endo",
   "weight": 40
  },
  {
   "name": "Ureteroscopy + laser lithotripsy",
   "category": "urs",
   "approach": "endo",
   "weight": 52
  },
  {
   "name": "RIRS (flexible ureteroscopy)",
   "category": "urs",
   "approach": "endo",
   "weight": 55
  },
  {
   "name": "JJ stent insertion",
   "category": "stent",
   "approach": "endo",
   "weight": 30
  },
  {
   "name": "JJ stent exchange",
   "category": "stent",
   "approach": "endo",
   "weight": 28
  },
  {
   "name": "Midurethral sling (TVT / TOT)",
   "category": "female",
   "approach": "",
   "weight": 60
  },
  {
   "name": "Male sling",
   "category": "female",
   "approach": "",
   "weight": 65
  },
  {
   "name": "Artificial urinary sphincter",
   "category": "female",
   "approach": "open",
   "weight": 75
  },
  {
   "name": "Bulking agent injection",
   "category": "female",
   "approach": "endo",
   "weight": 35
  },
  {
   "name": "Pelvic organ prolapse repair",
   "category": "female",
   "approach": "",
   "weight": 70
  },
  {
   "name": "Sacral neuromodulation",
   "category": "female",
   "approach": "",
   "weight": 60
  },
  {
   "name": "Urodynamic study",
   "category": "uds",
   "approach": "",
   "weight": 10
  },
  {
   "name": "Video-urodynamics",
   "category": "uds",
   "approach": "",
   "weight": 12
  },
  {
   "name": "Inguinal hernia repair, open",
   "category": "gs_groin",
   "approach": "open",
   "weight": 50
  },
  {
   "name": "Inguinal hernia repair, laparoscopic",
   "category": "gs_groin",
   "approach": "lap",
   "weight": 55
  },
  {
   "name": "Femoral hernia repair",
   "category": "gs_groin",
   "approach": "open",
   "weight": 52
  },
  {
   "name": "Appendectomy",
   "category": "gs_abdomen",
   "approach": "lap",
   "weight": 70
  },
  {
   "name": "Cholecystectomy",
   "category": "gs_abdomen",
   "approach": "lap",
   "weight": 75
  },
  {
   "name": "Exploratory laparotomy",
   "category": "gs_abdomen",
   "approach": "open",
   "weight": 85
  },
  {
   "name": "Small bowel resection + anastomosis",
   "category": "gs_abdomen",
   "approach": "open",
   "weight": 90
  },
  {
   "name": "Colectomy + anastomosis",
   "category": "gs_abdomen",
   "approach": "open",
   "weight": 95
  },
  {
   "name": "Adhesiolysis",
   "category": "gs_abdomen",
   "approach": "open",
   "weight": 70
  }
 ],
 "companions": {
  "TURP": [
   "Cystoscopy, rigid"
  ],
  "HoLEP": [
   "Cystoscopy, rigid"
  ],
  "ThuLEP": [
   "Cystoscopy, rigid"
  ],
  "Laser vaporization of prostate (PVP)": [
   "Cystoscopy, rigid"
  ],
  "TUIP": [
   "Cystoscopy, rigid"
  ],
  "TURBT": [
   "Cystoscopy, rigid"
  ],
  "Bladder biopsy": [
   "Cystoscopy, rigid"
  ],
  "Endoscopic reflux injection": [
   "Cystoscopy, rigid"
  ],
  "Ureteroscopy, diagnostic": [
   "Cystoscopy, rigid"
  ],
  "Ureteroscopy + laser lithotripsy": [
   "Cystoscopy, rigid"
  ],
  "RIRS (flexible ureteroscopy)": [
   "Cystoscopy, rigid"
  ],
  "JJ stent insertion": [
   "Cystoscopy, rigid"
  ],
  "JJ stent exchange": [
   "Cystoscopy, rigid"
  ]
 },
 "approaches": {
  "": "",
  "open": "פתוחה",
  "lap": "לפרוסקופית",
  "robotic": "רובוטית",
  "endo": "אנדוסקופית",
  "perc": "מלעורית"
 },
 "roles": {
  "primary": "מנתח ראשי",
  "assistant": "עוזר"
 },
 "defaults": [
  "Cystoscopy, flexible",
  "TURBT",
  "JJ stent insertion",
  "Ureteroscopy + laser lithotripsy",
  "TURP",
  "Circumcision",
  "Cystoscopy + retrograde pyelogram",
  "Transperineal prostate biopsy"
 ]
};
