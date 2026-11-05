export class AdapterError extends Error {
  constructor(kind, message) {
    super(message)
    this.name = 'AdapterError'
    this.kind = kind
  }
}
