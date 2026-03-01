import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ApiService {

  private base = 'http://localhost:3000/api';

  constructor(private http: HttpClient) {}

  login(email: string, password: string) {
    return this.http.post(this.base + '/login', { email, password });
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

  cancelBooking(id: number) {
    return this.http.put(this.base + '/cancel/' + id, {});
  }

  getAllBookings() {
    return this.http.get<any[]>(this.base + '/all-bookings-grouped');
  }

  adminDeleteBooking(id: number) {
    return this.http.delete(this.base + '/bookings/' + id); 
  }

  trainerSetStatus(id: number, status: string) {
    return this.http.put(this.base + '/trainer-booking-status/' + id, { status });
  }

  getProfile(id: number) {
  return this.http.get<any>(this.base + '/profile/' + id);
  }

  updateProfile(id:number,data:any){
  return this.http.put(this.base + '/profile/' + id, data);
  }

  deleteBooking(id: number) {
  return this.http.put(this.base + '/cancel/' + id, {});
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

  uploadAvatar(userId: number, file: File) {
  const fd = new FormData();
  fd.append('avatar', file);

  return this.http.post<any>(
    `${this.base}/upload-avatar/${userId}`,
    fd
  );
  }

  getAuditLog() {
  return this.http.get<any[]>(`${this.base}/audit`);
  }
}