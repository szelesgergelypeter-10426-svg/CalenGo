import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from './services/api.service';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ChangeDetectorRef } from '@angular/core'; ///ez kell a sikeres foglalás után hogy megjelenjen a sikeres foglalás page, mert magatol nem frissul le csak is valamilyen kattintas utan
import { registerLocaleData } from '@angular/common';///magyar dátumok
import localeHu from '@angular/common/locales/hu';///magyar dátumok
import { LOCALE_ID } from '@angular/core';///magyar dátumok
import { single } from 'rxjs';

registerLocaleData(localeHu);
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule,],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './app.html',
  styleUrls: ['./app.css', './app.extra.css'],
  providers: [{ provide: LOCALE_ID, useValue: 'hu' }],///magyar dátumok
})
export class AppComponent {

  toastMessage: string = '';
  toastType: 'success' | 'error' | '' = '';
  adminUsers: any[] = [];
  adminBookings: any[] = [];
  currentPage: 'login' | 'register' | 'trainers' | 'bookings' | 'booking' | 'admin-trainer-view'  |'trainer' | 'admin' | 'account' | 'booking-success'  = 'login';
  currentUserRole: string | null = null;
  currentUserId: number | null = null;
  takenTimes: string[] = [];
  trainerBookings: any[] = [];
  selectedTrainerId: number | null = null;
  editingId: number | null = null;
  editDate = '';
  editTime = '';
  auditLogs: any[] = [];
  bookingEmail: string = ''
  bookingSuccess: boolean = false;
  bookings: any[] = [];
  weekOffset = 0;
  weekDays: Date[] = [];
  timeSlots: string[] = [];
  currentWeekStart!: Date;
  selectedBooking: any = null;
  showBookingModal = false;
  trainers: any[] = [];
  currentTime: string = ''
  loginEmail: string = '';
  loginPassword: string = '';
  trainerBio: string = '';
  selectedTrainer: any = null;

  ///edzők típusai
  selectedSpecialty: string = '';

  trainerSpecialties: string[] = [
    'Kardió edző',
    'Erőnléti edző',
    'Testépítő edző',
    'Rehabilitációs edző',
    'Crossfit edző'
  ];


  
  constructor(
    private api: ApiService,
    private cd: ChangeDetectorRef ) {} ///kenyszeriti az angulart hogy frissitse a viewet amikor pl a sikeres foglalas utan a sikeres foglalas page nek kell megjenenie
    
    scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
}

///NAP KIVÁLASZTÁSA
selectDay(day: number) {
    if (this.isPastDate(day)) {
    this.showToast('Nem foglalhatsz múltbeli időpontra', 'error');
    return;
    }

    const m = String(this.currentMonth + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');

    this.selectedDate = `${this.currentYear}-${m}-${d}`;

    if (this.selectedTrainerId) {
      this.loadTrainerBookings(this.selectedTrainerId);
    }
}

showPage(page: 'login' | 'register' | 'trainers' | 'bookings' | 'booking' | 'trainer' | 'admin' | 'account' | 'booking-success' | 'admin-trainer-view') {
  this.bookingSuccess = false;
  this.currentPage = page;

  setTimeout(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, 0);

  if (page === 'trainers') {
    this.loadTrainers();
  }
}
  ///LOGOUT
  logout() {
  this.currentUserRole = null;
  this.currentUserId = null;
  this.profile = { name:'', email:'', password:'', avatar:'' };
  this.trainerBookings = [];
  this.bookings = [];
  this.adminUsers = [];
  this.adminBookings = [];
  this.showPage('login');
  }
  
  ///LOGOUT MEGERŐSÍTÉS
  logoutConfirm(){
  if(confirm("Biztos ki szeretnél jelentkezni?")){
    this.logout();
  }
  }
  ///PASSWORD INPUT VISIBLE
  showPassword = false;
  
  ///PROFIL BETOLTESE + MENTÉS
loadProfile(){
  if(!this.currentUserId) return;

  this.api.getProfile(this.currentUserId)
  .subscribe(p => {
    this.profile = p;

    this.selectedSpecialty =
  p.specialty && p.specialty.trim() !== ''
    ? p.specialty
    : 'Személyi edző';

    this.cd.detectChanges();
  });

    ///a trainer profilon mutassa a bio-t
    if (this.currentUserRole === 'trainer') {
      this.api.getTrainerBio(this.currentUserId!)
        .subscribe(res => {this.trainerBio = res.bio || '';});
      }
  }
  
  ///EDZŐ SPECIALITY betöltés
loadspecialty() {
  const saved = localStorage.getItem('trainerSpecialty');
  if (saved) {
    this.selectedSpecialty = saved;
  }}

///EDZŐ SPECIALITY MENTÉS  
saveSpecialty() {
  if (!this.currentUserId) return;

  this.api.updateProfile(this.currentUserId, {
    name: this.profile.name,
    email: this.profile.email,
    password: this.profile.password,
    avatar: this.profile.avatar,
    specialty: this.selectedSpecialty || 'Személyi edző'
  }).subscribe({
    next: () => {
  this.showToast("Edző típus mentve!");

  this.selectedSpecialty =
    this.selectedSpecialty || 'Személyi edző';

  this.loadProfile();
  this.loadTrainers();
} ,
    error: () => {
      this.showToast("Mentési hiba", "error");
    }
  });
}

  ///STÁTUSZ OSZTÁLY
statusClass(s: string) {
  return {
    folyamatban: 'bg-yellow-500 text-white px-2 py-1 rounded',
    elfogadva: 'bg-green-600 text-white px-2 py-1 rounded',
    elutasítva: 'bg-red-600 text-white px-2 py-1 rounded',
    törölve: 'bg-gray-500 text-white px-2 py-1 rounded'
  }[s];
}
  
  //PROFIL MENTÉSE
saveProfile() {
    console.log("MENTÉS ELŐTT:", this.profile);
  ///EMAIL VALIDÁCIÓ
  if (!this.isValidEmail(this.profile.email)) {
  this.showToast('Hibás email formátum', 'error');
  return;
  }
  if (!confirm('Biztosan módosítod az adatokat?')) return;
  this.api.updateProfile(this.currentUserId!, this.profile)
    .subscribe({next: () => {
      this.showToast('Profil frissítve');
      this.loadProfile();
      if (this.currentUserRole === 'trainer') {
        this.api.updateTrainerBio(this.currentUserId!, this.trainerBio)
        .subscribe();}
      },

      error: () => {
        this.showToast('Mentés hiba', 'error');
      }
    });
  }

  showToast(msg: string, type: 'success' | 'error' = 'success') {
  this.toastMessage = msg;
  this.toastType = type;

  setTimeout(() => {
    this.toastMessage = '';
    this.toastType = '';
  }, 3000);
  }


  // =====================
  // AUTH — BACKEND
  // =====================

  loginUser(email: string, password: string) {
  if (!email || !password) {
    this.showToast('Email és jelszó megadása kötelező', 'error');
    return;
  }

  this.api.login(email, password)
    .subscribe({

      next: (user: any) => {

        this.currentUserRole = user.role;
        this.currentUserId = user.id;

        this.showToast('Sikeres bejelentkezés');

        // Clear login form
        this.loginEmail = '';
        this.loginPassword = '';

        // USER
        if (user.role === 'user') {
          this.loadMyBookings();
          this.showPage('trainers');
        }

        // ADMIN
        else if (user.role === 'admin') {
          this.loadAdminData();
          this.showPage('admin');
        }

        // TRAINER
        else if (user.role === 'trainer') {
          this.loadProfile();
          this.generateWeek();
          this.generateTimeSlots();
          this.loadTrainerBookingsView();
          this.showPage('trainer');
        }

      },

      error: () => {
        this.showToast('Hibás belépés', 'error');
      }

    });
  }
    
// USER REGISZTARACIO
  registerLoading = false;
  registerUser(name: string, email: string, password: string) {

    if (this.registerLoading) return;
  this.registerLoading = true;
  
  if (!name || !email || !password) {
  this.showToast("Minden mező kötelező", "error");
  this.registerLoading = false;
  return;
  }

  if (!this.isValidEmail(email)) {
    alert("Hibás email formátum");
    this.registerLoading = false;
    return;
  }

  if (password.length < 8) {
    alert("A jelszó túl rövid");
    this.registerLoading = false;
    return;
  }

  this.api.register(name, email, password)
    .subscribe({
      next: () => {
        this.registerLoading = false;
        this.showToast('Sikeres regisztráció');
        this.showPage('login');
      },
      error: () => {
        this.registerLoading = false;
        this.showToast('Regisztráció sikertelen', 'error');
      }
    });
    }

    startEdit(b:any) {
  this.editingId = b.id;
  this.editDate = b.date;
  this.editTime = b.time;
}

///SMOOTH LEGORDULESEK /REGISZTRACIO,EDZOK,ÁRAK,ELERHETOSEG,
scrollToRegister() {
  const el = document.getElementById('registerSection');
  if (el) {
    el.scrollIntoView({
      behavior: 'smooth'
    });
  }
}

scrollToTrainers() {
  const el = document.getElementById('trainersSection');
  el?.scrollIntoView({ behavior: 'smooth' });
}



scrollToContact() {
  const el = document.getElementById('contactSection');
  el?.scrollIntoView({ behavior: 'smooth' });
}

saveEdit(id: number) {

  if (!this.editDate || !this.editTime) {
    this.showToast('Hiányzó adat','error');
    return;
  }

  this.api.updateBooking(id, this.editDate, this.editTime)
    .subscribe({
      next: () => {
        this.showToast('Időpont módosítva');
        this.editingId = null;
        this.loadTrainerBookingsView();
      },
      error: () => this.showToast('Hiba','error')
      
});}



cancelEdit() {
  this.editingId = null;}

  selectTrainer(id: number) {

  this.selectedTrainer = this.trainers.find(t => t.id === id);
  this.selectedTrainerId = id;

  if (this.currentUserRole === 'admin') {

    this.generateWeek();
    this.generateTimeSlots();
    this.loadTrainerBookingsViewForAdmin(id);
    this.trainerBookings = []; 

    this.showPage('admin-trainer-view');
    return;
  }

  // user esetén
  this.selectedDate = null;
  this.selectedTime = null;
  this.takenTimes = [];
  this.availableTimes = this.trainerSchedule;

  this.showPage('booking');
}

  ///NAPTÁR
  selectedDate: string | null = null;
  selectedTime: string | null = null;

  currentYear = new Date().getFullYear();
  currentMonth = new Date().getMonth();

monthNames = [
  'Január', 'Február', 'Március', 'Április', 'Május', 'Június',
  'Július', 'Augusztus', 'Szeptember', 'Október', 'November', 'December'
];

  calendarDays: (number | null)[] = [];

  intervalId: any; ///elmenti z interval id t hogy ne fusson tovabb ha kilepünk az oldalrol

  ngOnInit() {
  this.bookingSuccess = false;
  this.generateCalendar();
  this.generateTimeSlots();
  this.generateWeek();
  this.loadTrainers(); 
  this.updateClock(); // azonnal mutassa az aktuális időt
  this.intervalId = setInterval(() => this.updateClock(), 1000); /// meghivja az updateclockot masodpercenkent.
  }

  ngOnDestroy() {
  clearInterval(this.intervalId); ///ez akkor fut le amikor elhagyjuk az oldalt, vagy ujratoltjuk hogy ne fusson allandoan es ne nyiljon  meg a hatterben minden ujratoltesnel.
  }

  updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  this.currentTime = `${h}:${m}:${s}`;
  }

  ///edzők naptára betöltése adminnál
loadTrainerBookingsViewForAdmin(trainerId: number) {
  this.api.getTrainerBookings(trainerId)
    .subscribe((b: any[]) => {
      console.log("BOOKINGS API:", b);
      this.trainerBookings = b;
      this.cd.detectChanges();
    });
  }


  generateCalendar() {
    this.calendarDays = [];

    const firstDay = new Date(this.currentYear, this.currentMonth, 1).getDay();
    const daysInMonth = new Date(
      this.currentYear,
      this.currentMonth + 1,
      0
    ).getDate();

    const offset = firstDay === 0 ? 6 : firstDay - 1;

    for (let i = 0; i < offset; i++) {
      this.calendarDays.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      this.calendarDays.push(day);
    }
  }


  ///acccept/reject pop up gomb
updateBookingStatus(status: 'elfogadva' | 'elutasítva') {
  if (!this.selectedBooking) return;

  this.api.setBookingStatus(this.selectedBooking.id, status)
    .subscribe({
      next: () => {
        this.showToast('Státusz frissítve');
        this.loadTrainerBookingsView();
        this.closeBookingModal();
      },
      error: () => {
        this.showToast('Hiba', 'error');
      }
    });
}
  
  ///IDŐPONTOK GENERÁLÁSA
  generateTimeSlots() {
  this.timeSlots = [];

  for (let h = 7; h <= 20; h++) {
    const start = String(h).padStart(2,'0') + ':00';
    const end = String(h+1).padStart(2,'0') + ':00';
    this.timeSlots.push(`${start}-${end}`);
  }
  }

  ///HETI NAPTÁR GENERÁLÁSA
  generateWeek() {
    const today = new Date(); 
    const monday = new Date(today);

    monday.setDate(today.getDate() - today.getDay() + 1 + this.weekOffset * 7);

    this.weekDays = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      this.weekDays.push(d);
    }
  }

  

  ///lapozás a hetek között
  nextWeek() {
  this.weekOffset++;
  this.generateWeek();
  this.loadTrainerBookingsView(); 
}

prevWeek() {
  this.weekOffset--;
  this.generateWeek();
  this.loadTrainerBookingsView();
}
  ///booking keresése
  getBookingFor(day: Date, slot: string) {
  const dateStr = day.toISOString().slice(0,10);
  const startTime = slot.split('-')[0];

  return this.trainerBookings.find(b =>
    b.date === dateStr && b.time === startTime
  );
  }

  ///cellák szín beállítása
  getBookingColor(b: any): string {
  if (!b?.status) return 'bg-gray-700';

  const s = String(b.status).toLowerCase().trim();

  const map: Record<string, string> = {
    ///magyar státuszok
    'folyamatban': 'bg-purple-600',
    'elfogadva': 'bg-green-600',
    'elutasítva': 'bg-red-600'
    };

  return map[s] || 'bg-gray-700';
  }

  

  ///booking nslot generalas
  getBookingForSlot(day: Date, time: string) {
  const dateStr = day.toISOString().slice(0,10);

  return this.trainerBookings.find(b =>
    b.date === dateStr &&
    b.time === time &&
    b.trainerId === this.currentUserId
  );
  }

  ///kockak szinezese
  getSlotClass(day: Date, time: string) {
  const b = this.getBookingForSlot(day, time);

  if (!b) return 'bg-gray-800 hover:bg-gray-700';

  if (b.status === 'folyamatban') return 'bg-purple-600';
  if (b.status === 'elfogadva') return 'bg-green-600';
  if (b.status === 'elutasítva') return 'bg-red-600';

  return '';
  }

  ///pop up
  openSlot(day: Date, time: string) {
  const booking = this.getBookingForSlot(day, time);
  if (!booking) return;

  this.selectedBooking = booking;
  }

  openTrainerSelectForAdmin() {
  this.selectedTrainer = null;
  this.showPage('trainers');
}


  ///kattintás nyitas
  openBooking(b: any) {
  if (!b) return;
    this.selectedBooking = b;
    this.showBookingModal = true;
  }
  ///kattintas zaras
  closeBookingModal() {
    this.showBookingModal = false;
    this.selectedBooking = null;
  }
  
  // EDZŐ IDŐPONTOK
  trainerSchedule = {
  morning: ['08:00','09:00','10:00', '11:00', '12:00'],
  afternoon: ['13:00','14:00','15:00', '16:00', '17:00'],
  evening: ['18:00','19:00','20:00']
  };

  ///BÉRLET ÁRAK
prices = [
  { 
    category: 'Diák', 
    monthly: '10000 Ft', 
    single: '2000 Ft',
    description: 'Kedvezményes bérlet diákok számára, korlátlan teremhasználattal.'
  },
  { 
    category: 'Felnőtt', 
    monthly: '15000 Ft', 
    single: '2500 Ft',
    description: 'Teljes hozzáférés minden szolgáltatáshoz és eszközhöz.'
  },
  { 
    category: 'Nyugdíjas', 
    monthly: '6000 Ft', 
    single: '1500 Ft',
    description: 'Kedvezményes ár nyugdíjasok számára.'
  },
];
//EDZŐI ÁRAK
trainerprices = [
  { 
    trainerCategory: 'Diák', 
    singleTime: '5000Ft',
    monthly: '11000 Ft', 
    trainerPriceDescription: 'Kedvezményes személyreszabott edzésprogram és teljes körű hozzáférés az edzőterem eszközeihez.'
  },
  { 
    trainerCategory: 'Felnőtt', 
    singleTime: '7500Ft',
    monthly: '17500 Ft', 
    trainerPriceDescription: 'Személyreszabott edzésprogram és teljes körű hozzáférés az edzőterem eszközeihez.'
  },
  { 
    trainerCategory: 'Nyugdíjas', 
    singleTime: '4000Ft',
    monthly: '10000 Ft', 
    trainerPriceDescription: 'Kedvezményes személyreszabott edzésprogram és teljes körű hozzáférés az edzőterem eszközeihez.'
  },
];

  scrollToPrices() {
    const el = document.getElementById('prices');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }

  availableTimes = {
    morning: [] as string[],
    afternoon: [] as string[],
    evening: [] as string[]
  };

  selectDateInput(event: any) {
    this.selectedDate = event.target.value;
    this.selectedTime = null;
  }

  selectTime(time: string) {
    if (this.isPastTime(time)) {
    this.showToast('Ez az időpont már elmúlt', 'error');
    return;
    }
    this.selectedTime = time;
  }



  // =====================
  // BOOKINGS 
  // =====================

    
bookingLoading = false;

  bookAppointment() {

  if (!this.selectedDate || !this.selectedTime) {
    this.showToast('Válassz dátumot és időt','error');
    return;
  }

  if (!this.bookingEmail || !this.isValidEmail(this.bookingEmail)) {
    this.showToast('Hibás email formátum','error');
    return;
  }

  if (this.bookingLoading) return;

  this.bookingLoading = true;

  this.api.createBooking({
    userId: this.currentUserId!,
    trainerId: this.selectedTrainerId!,
    date: this.selectedDate!,
    time: this.selectedTime!.split('-')[0],
    email: this.bookingEmail
  })
  .subscribe({

    next: (res:any) => {

      this.bookingLoading = false;

      if (res?.success) {

        this.selectedDate = null;
        this.selectedTime = null;
        this.bookingEmail = '';

        
        this.showPage('booking-success');

        this.cd.detectChanges(); /// itt forcoljuk az angulart hogy frissitse a viewt

        
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'auto' });
        }, 50);
        }
      else{
            this.showToast('Foglalás sikertelen','error');
          }

        },

    error: () => {
      this.bookingLoading = false;
      this.showToast('Foglalás sikertelen','error');
    }

  });

}

  loadMyBookings() {
  if (!this.currentUserId) return;

  this.api.getMyBookings(this.currentUserId)
    .subscribe((rows: any) => {
      this.bookings = rows.map((r: any) => ({
        id: r.id,
        trainer: r.trainerName,
        date: r.date,
        time: r.time,
        status: r.status
      }));
    });
  }

  cancelBookingBackend(id: number) {

  if (!confirm('Biztos törlöd?')) return;

  this.api.deleteBooking(id)
    .subscribe({

      next: () => {
        this.showToast('Foglalás törölve');
        this.loadMyBookings();
      },

      error: () => {
        this.showToast('Törlés hiba', 'error');
      }

    });

  }
  

  //ADMIN ADATOK BETOLTESE
  
  loadAdminData() {
    this.api.getUsers().subscribe(u => this.adminUsers = u);
    this.api.getAllBookings().subscribe((b: any[]) => this.adminBookings = b);
    this.api.getAuditLog().subscribe(l => this.auditLogs = l);
  }


  //ADMIN FOGLALAS TÖRLÉSE
  deleteBooking(id: number) {
  this.api.deleteBooking(id)
    .subscribe(() => this.loadAdminData());
  }
 //ADMIN USER TORLESE
  adminDeleteUser(id: number) {

  if (!confirm("Biztosan törlöd a felhasználót?")) return;

  this.api.deleteUser(id).subscribe({
    next: () => {
      this.showToast('Felhasználó törölve');
      this.loadAdminData();
    },
    error: () => {
      this.showToast('Törlés hiba', 'error');
    }
  });
  }

  profile = {
  name: '',
  email: '',
  password: '',
  avatar: ''
  };

  ///PROFILKÉP MŰKÖDÉSE
  getAvatarUrl(path: string | null): string {
  if (!path) return 'assets/default.png';

  const base = path.startsWith('http')
    ? path
    : 'http://localhost:3000' + path;


  return base + '?t=' + new Date().getTime();
  }



  //FOGLALT NAPOK LETILTASA
  loadTrainerBookings(trainerId: number) {
    this.api.getTrainerBookings(trainerId)
      .subscribe((rows: any[]) => {

        this.takenTimes = rows
        .filter(b => b.date === this.selectedDate && b.status !== 'törölve')
          .map(b => b.time);
        console.log("FOGLALT IDŐK:", this.takenTimes);
        });
  }

  
  ///ADMIN ROLE CHANGE
  changeUserRole(userId: number, role: string) {

  this.api.updateUserRole(userId, role)
    .subscribe({

      next: () => {
        this.showToast('Szerepkör frissítve');
        this.loadAdminData();
      },

      error: () => {
        this.showToast('Mentési hiba', 'error');
      }

    });
  }

  //ADMIN FOGALÁS FRISSÍTÉS
  adminUpdateBooking(id: number, date: string, time: string) {

  this.api.updateBooking(id, date, time)
    .subscribe({

      next: () => {
        this.showToast('Foglalás frissítve');
        this.loadAdminData();
      },

      error: () => {
        this.showToast('Update hiba', 'error');
      }

    });

  }

  //TRAINER BOOKING VIEW
  loadTrainerBookingsView() {

  if (!this.currentUserId) return;

  this.api.getTrainerBookings(this.currentUserId)
    .subscribe((b: any[]) => this.trainerBookings = b);
  }

  //TRAINER BOOKING VIEW STATUS CHANGE --jó api bekötve
  trainerSetStatus(id: number, status: string) {

  this.api.setBookingStatus(id, status)
  .subscribe({

      next: () => {
        this.showToast('Státusz módosítva');
        this.loadTrainerBookingsView();
      },

      error: () => {
        this.showToast('Hiba', 'error');
      }

    });

  }
  
  ///LOGIN UTANI OLDAL IRANYITAS
goMyBookings() {
  if (this.currentUserRole === 'trainer') {
    this.loadTrainerBookingsView();
    this.currentPage = 'trainer';
  } else if (this.currentUserRole === 'user') {
    this.loadMyBookings();
    this.currentPage = 'bookings';
}}

/// MÚLTBELI IDŐPONTOK LETILTÁSA
isPastDate(day: number): boolean {
  const today = new Date();

  const checkDate = new Date(
    this.currentYear,
    this.currentMonth,
    day
  );
  
  today.setHours(0,0,0,0);
  checkDate.setHours(0,0,0,0);

  return checkDate < today;
}
/// ÁRAK legördülő menü
openedPriceIndex: number | null = null;
openedTrainerPriceIndex: number | null = null;

togglePrice(index: number) {
  this.openedPriceIndex = this.openedPriceIndex === index ? null : index;
}

toggleTrainerPrice(index: number) {
  this.openedTrainerPriceIndex = this.openedTrainerPriceIndex === index ? null : index;
}
///trainerek legördülő bio a main pagen
openedTrainer: number | null = null;

toggleTrainer(i: number) {
  this.openedTrainer = this.openedTrainer === i ? null : i;
}

getTrainerBioText(t: any): string {
  if (!t.bio || t.bio.trim() === '') {return `${t.name} edző jelenleg még nem osztotta meg személyes tapasztalatait, érdeklődjön személyesen vagy vegye fel vele a kapcsolatot Emailben.`;}
  return t.bio;
}

///múltbeli dátum (óra szerint) tiltás
isPastTime(time: string): boolean {
  if (!this.selectedDate) return false;

  const now = new Date();
  const todayStr = now.toISOString().slice(0,10);

  if (this.selectedDate !== todayStr) return false;

  const currentHour = now.getHours();
  const slotHour = parseInt(time.split(':')[0]);

  return slotHour <= currentHour;
}

loadTrainers() {
  this.api.getTrainers().subscribe({
    next: (list: any[]) => {
      this.trainers = list;
      console.log('Trainers betöltve:', this.trainers);

      this.cd.detectChanges(); 
    },
    error: (err) => {
      console.error('Hiba a tréner lista betöltésénél', err);
    }
  });
}

  onDateSelected() {
  if (this.selectedTrainerId !== null) {
    this.loadTrainerBookings(this.selectedTrainerId);
  }
  }

 //STÁTUSZ SZÖVEG
  statusLabel(s: string) {
  return {
    pending: 'Folyamatban',
    approved: 'Elfogadva',
    rejected: 'Elutasítva',
    cancelled: 'Törölve',

    folyamatban: 'Folyamatban',
    elfogadva: 'Elfogadva',
    elutasítva: 'Elutasítva',
    törölve: 'Törölve'
  }[s] || s;
  }

  //EMAIL VALIDÁCIÓ
  isValidEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
  }

///edzők típusai
specialties = [
  'Kardió edző',
  'Erőnléti edző',
  'Testépítő edző',
  'Funkcionális edző',
  'Rehabilitációs edző'
];

///hónap navigáció
prevMonth() {
  const now = new Date();

    ///ne lehessen visszalepni multbeli honapokra
  if (
    this.currentYear === now.getFullYear() &&
    this.currentMonth === now.getMonth()
  ) {
    this.showToast('Nem léphetsz vissza múltbeli hónapra', 'error');
    return;
  }

  this.currentMonth--;

  if (this.currentMonth < 0) {
    this.currentMonth = 11;
    this.currentYear--;
  }

  this.generateCalendar();
  this.resetSelection();
}

nextMonth() {
  this.currentMonth++;

  if (this.currentMonth > 11) {
    this.currentMonth = 0;
    this.currentYear++;
  }

  this.generateCalendar();
  this.resetSelection();
}
resetSelection() {
  this.selectedDate = null;
  this.selectedTime = null;
  this.takenTimes = [];
}
}