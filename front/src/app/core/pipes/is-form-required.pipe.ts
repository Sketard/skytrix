import { Pipe, PipeTransform } from '@angular/core';
import { AbstractControl } from '@angular/forms';

@Pipe({ name: 'isFormControlRequired', standalone: true })
export class IsFormControlRequiredPipe implements PipeTransform {
  transform(form: AbstractControl): boolean {
    if (!form.validator) {
      return false;
    }
    const validator = form.validator({} as AbstractControl);
    return validator?.['required'];
  }
}
