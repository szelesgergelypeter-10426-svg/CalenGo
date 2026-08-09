import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000/api'
  : `${window.location.protocol}//${window.location.hostname}/api`;
  
  constructor(private http: HttpClient) {}
  
  private getHeaders(): HttpHeaders {
    const token = localStorage.getItem('token');
    return new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    });
  }

  login(email: string, password: string, rememberMe: boolean = false) {
    return this.http.post(this.base + '/login', { email, password, rememberMe });
  }

  register(name: string, email: string, password: string) {
    return this.http.post(this.base + '/register', { name, email, password });
  }

  getUsers() {
    return this.http.get<any[]>(this.base + '/users', { headers: this.getHeaders() });
  }

  deleteUser(id: number) {
    return this.http.delete(this.base + '/users/' + id, { headers: this.getHeaders() });
  }

  getTrainers() {
    return this.http.get<any[]>(this.base + '/trainers');
  }

  createBooking(data: any) {
    return this.http.post(this.base + '/book', data, { headers: this.getHeaders() });
  }

  getMyBookings(userId: number) {
    return this.http.get<any[]>(this.base + '/my-bookings/' + userId, { headers: this.getHeaders() });
  }

  getTrainerBookings(trainerId: number) {
    return this.http.get<any[]>(this.base + '/trainer-bookings/' + trainerId, { headers: this.getHeaders() });
  }

  deleteBooking(id: number) {
    return this.http.delete(this.base + '/bookings/' + id, { headers: this.getHeaders() });
  }

  getProfile(id: number) {
    return this.http.get<any>(this.base + '/profile/' + id, { headers: this.getHeaders() });
  }

  updateProfile(id: number, data: any) {
    return this.http.put(this.base + '/profile/' + id, data, { headers: this.getHeaders() });
  }

  updateBooking(id: number, date: string, time: string) {
    return this.http.put(`${this.base}/booking/${id}`, { date, time }, { headers: this.getHeaders() });
  }

  updateUserRole(userId: number, role: string) {
    return this.http.put(this.base + '/user-role/' + userId, { role }, { headers: this.getHeaders() });
  }

  setBookingStatus(id: number, status: string) {
    return this.http.put(this.base + '/trainer-booking-status/' + id, { status }, { headers: this.getHeaders() });
  }

  getAuditLog() {
    return this.http.get<any[]>(`${this.base}/audit`, { headers: this.getHeaders() });
  }

  getTrainerBio(id: number) {
    return this.http.get<any>(this.base + '/trainer-bio/' + id, { headers: this.getHeaders() });
  }

  updateTrainerBio(id: number, bio: string) {
    return this.http.put(this.base + '/trainer-bio/' + id, { bio }, { headers: this.getHeaders() });
  }

  verifyTwoFactor(userId: number, code: string) {
  return this.http.post(this.base + '/verify-2fa', { userId, code });
  }

  toggleTwoFactor(enabled: boolean) {
    return this.http.post(this.base + '/toggle-2fa', { enabled }, { headers: this.getHeaders() });
    }

  logout() {
    return this.http.post(this.base + '/logout', {}, { headers: this.getHeaders() });
  }

  getBaseUrl(): string {
  return this.base;
  }

  getBackendUrl(): string {
  // A base tartalmazza az '/api'-t
  return this.base.replace(/\/api$/, '');
  }

  logoutAll() {
    return this.http.post(this.base + '/logout-all', {}, { headers: this.getHeaders() });
  }
}

export interface SafeUser {
  id: number;
  name: string;
  email: string;
  role: string;
  avatar?: string;
  specialty?: string;
}

export interface SafeBooking {
  id: number;
  userId: number;
  trainerId: number;
  date: string;
  time: string;
  status: string;
  email?: string;
}