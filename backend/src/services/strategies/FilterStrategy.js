export class FilterStrategy {
  constructor(name) {
    this.name = name;
  }

  apply(entries) {
    throw new Error(`FilterStrategy "${this.name}" must implement apply(entries)`);
  }
}
