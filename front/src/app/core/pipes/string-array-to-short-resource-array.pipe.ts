import { Pipe, PipeTransform } from '@angular/core';
import { AutocompleteOption } from '../model/commons/short-resource';

@Pipe({ name: 'stringArrayToShortResourceArray', standalone: true })
export class StringListToAutocompleteObjectPipe<T> implements PipeTransform {
  transform(values: Array<T>, key: string = ''): Array<AutocompleteOption<T>> {
    return values.map(value => ({ id: value, name: key + value }));
  }
}
