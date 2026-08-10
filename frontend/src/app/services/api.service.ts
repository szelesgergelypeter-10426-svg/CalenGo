import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000/api'
    : `${window.location.protocol}//${window.location.hostname}/api`;
  
  constructor(private http: HttpClient) {}

  login(email: string, password: string, rememberMe: boolean = false) {
    return this.http.post(this.base + '/login', { email, password, rememberMe }, { withCredentials: true });
  }

  register(name: string, email: string, password: string) {
    return this.http.post(this.base + '/register', { name, email, password }, { withCredentials: true });
  }

  getUsers() {
    return this.http.get<any[]>(this.base + '/users', { withCredentials: true });
  }

  deleteUser(id: number) {
    return this.http.delete(this.base + '/users/' + id, { withCredentials: true });
  }

  getTrainers() {
    return this.http.get<any[]>(this.base + '/trainers', { withCredentials: true });
  }

  createBooking(data: any) {
    return this.http.post(this.base + '/book', data, { withCredentials: true });
  }

  getMyBookings(userId: number) {
    return this.http.get<any[]>(this.base + '/my-bookings/' + userId, { withCredentials: true });
  }

  getTrainerBookings(trainerId: number) {
    return this.http.get<any[]>(this.base + '/trainer-bookings/' + trainerId, { withCredentials: true });
  }

  deleteBooking(id: number) {
    return this.http.delete(this.base + '/bookings/' + id, { withCredentials: true });
  }

  getProfile(id: number) {
    return this.http.get<any>(this.base + '/profile/' + id, { withCredentials: true });
  }

  updateProfile(id: number, data: any) {
    return this.http.put(this.base + '/profile/' + id, data, { withCredentials: true });
  }

  updateBooking(id: number, date: string, time: string) {
    return this.http.put(`${this.base}/booking/${id}`, { date, time }, { withCredentials: true });
  }

  updateUserRole(userId: number, role: string) {
    return this.http.put(this.base + '/user-role/' + userId, { role }, { withCredentials: true });
  }

  setBookingStatus(id: number, status: string) {
    return this.http.put(this.base + '/trainer-booking-status/' + id, { status }, { withCredentials: true });
  }

  getAuditLog() {
    return this.http.get<any[]>(`${this.base}/audit`, { withCredentials: true });
  }

  getTrainerBio(id: number) {
    return this.http.get<any>(this.base + '/trainer-bio/' + id, { withCredentials: true });
  }

  updateTrainerBio(id: number, bio: string) {
    return this.http.put(this.base + '/trainer-bio/' + id, { bio }, { withCredentials: true });
  }

  verifyTwoFactor(userId: number, code: string) {
    return this.http.post(this.base + '/verify-2fa', { userId, code }, { withCredentials: true });
  }

  toggleTwoFactor(enabled: boolean) {
    return this.http.post(this.base + '/toggle-2fa', { enabled }, { withCredentials: true });
  }

  logout() {
    return this.http.post(this.base + '/logout', {}, { withCredentials: true });
  }

  logoutAll() {
    return this.http.post(this.base + '/logout-all', {}, { withCredentials: true });
  }

  getBaseUrl(): string {
    return this.base;
  }

  getBackendUrl(): string {
    return this.base.replace(/\/api$/, '');
  }

  uploadAvatar(file: File): Promise<any> {
    const formData = new FormData();
    formData.append('avatar', file);
    return this.http.post(this.base + '/upload-avatar', formData, { withCredentials: true }).toPromise();
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