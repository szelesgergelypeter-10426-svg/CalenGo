import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000/api'
    : `${window.location.protocol}//${window.location.hostname}/api`;
  
  constructor(private http: HttpClient) {}

  login(email: string, password: string, rememberMe: boolean = false) {
    return this.http.post(this.base + '/login', { email, password, rememberMe });
  }

  register(name: string, email: string, password: string) {
    return this.http.post(this.base + '/register', { name, email, password });
  }

  getUsers() {
    return this.http.get<any[]>(this.base + '/users');
  }

  deleteUser(id: number) {
    return this.http.delete(this.base + '/users/' + id);
  }

  getTrainers() {
    return this.http.get<any[]>(this.base + '/trainers');
  }

  createBooking(data: any) {
    return this.http.post(this.base + '/book', data);
  }

  getMyBookings(userId: number) {
    return this.http.get<any[]>(this.base + '/my-bookings/' + userId);
  }

  getTrainerBookings(trainerId: number) {
    return this.http.get<any[]>(this.base + '/trainer-bookings/' + trainerId);
  }

  deleteBooking(id: number) {
    return this.http.delete(this.base + '/bookings/' + id);
  }

  getProfile(id: number) {
    return this.http.get<any>(this.base + '/profile/' + id);
  }

  updateProfile(id: number, data: any) {
    return this.http.put(this.base + '/profile/' + id, data);
  }

  updateBooking(id: number, date: string, time: string) {
    return this.http.put(`${this.base}/booking/${id}`, { date, time });
  }

  updateUserRole(userId: number, role: string) {
    return this.http.put(this.base + '/user-role/' + userId, { role });
  }

  setBookingStatus(id: number, status: string) {
    return this.http.put(this.base + '/trainer-booking-status/' + id, { status });
  }

  getAuditLog() {
    return this.http.get<any[]>(`${this.base}/audit`);
  }

  getTrainerBio(id: number) {
    return this.http.get<any>(this.base + '/trainer-bio/' + id);
  }

  updateTrainerBio(id: number, bio: string) {
    return this.http.put(this.base + '/trainer-bio/' + id, { bio });
  }

  verifyTwoFactor(userId: number, code: string) {
    return this.http.post(this.base + '/verify-2fa', { userId, code });
  }

  toggleTwoFactor(enabled: boolean) {
    return this.http.post(this.base + '/toggle-2fa', { enabled });
  }

  logout() {
    return this.http.post(this.base + '/logout', {});
  }

  logoutAll() {
    return this.http.post(this.base + '/logout-all', {});
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
    return this.http.post(this.base + '/upload-avatar', formData).toPromise();
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