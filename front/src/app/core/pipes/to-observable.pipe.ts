import { Pipe, PipeTransform } from '@angular/core';
import { Observable, of } from 'rxjs';

@Pipe({ name: 'toObservable', standalone: true })
export class ToObservablePipe implements PipeTransform {
  transform(value: any): Observable<any> {
    return of(value);
  }
}
