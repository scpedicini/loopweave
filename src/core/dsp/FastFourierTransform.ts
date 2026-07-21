export class FastFourierTransform {
  readonly size: number
  private readonly bitReversal: Uint32Array
  private readonly cosine: Float64Array
  private readonly sine: Float64Array
  private readonly window: Float64Array
  private readonly real: Float64Array
  private readonly imaginary: Float64Array

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, received ${size}`)
    }

    this.size = size
    this.bitReversal = this.createBitReversal(size)
    this.cosine = new Float64Array(size / 2)
    this.sine = new Float64Array(size / 2)
    this.window = new Float64Array(size)
    this.real = new Float64Array(size)
    this.imaginary = new Float64Array(size)

    for (let index = 0; index < size / 2; index += 1) {
      const phase = (-2 * Math.PI * index) / size
      this.cosine[index] = Math.cos(phase)
      this.sine[index] = Math.sin(phase)
    }

    for (let index = 0; index < size; index += 1) {
      this.window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1))
    }
  }

  magnitude(input: Float32Array, offset = 0): Float32Array {
    const { size } = this
    for (let index = 0; index < size; index += 1) {
      const sourceIndex = offset + index
      const value = sourceIndex >= 0 && sourceIndex < input.length ? (input[sourceIndex] ?? 0) : 0
      const targetIndex = this.bitReversal[index] ?? 0
      this.real[targetIndex] = value * (this.window[index] ?? 1)
      this.imaginary[targetIndex] = 0
    }

    for (let width = 2; width <= size; width *= 2) {
      const halfWidth = width / 2
      const twiddleStep = size / width
      for (let blockStart = 0; blockStart < size; blockStart += width) {
        for (let index = 0; index < halfWidth; index += 1) {
          const evenIndex = blockStart + index
          const oddIndex = evenIndex + halfWidth
          const twiddleIndex = index * twiddleStep
          const twiddleReal = this.cosine[twiddleIndex] ?? 1
          const twiddleImaginary = this.sine[twiddleIndex] ?? 0
          const oddReal = this.real[oddIndex] ?? 0
          const oddImaginary = this.imaginary[oddIndex] ?? 0
          const rotatedReal = twiddleReal * oddReal - twiddleImaginary * oddImaginary
          const rotatedImaginary = twiddleReal * oddImaginary + twiddleImaginary * oddReal
          const evenReal = this.real[evenIndex] ?? 0
          const evenImaginary = this.imaginary[evenIndex] ?? 0

          this.real[evenIndex] = evenReal + rotatedReal
          this.imaginary[evenIndex] = evenImaginary + rotatedImaginary
          this.real[oddIndex] = evenReal - rotatedReal
          this.imaginary[oddIndex] = evenImaginary - rotatedImaginary
        }
      }
    }

    const magnitude = new Float32Array(size / 2 + 1)
    for (let index = 0; index < magnitude.length; index += 1) {
      magnitude[index] = Math.hypot(this.real[index] ?? 0, this.imaginary[index] ?? 0)
    }
    return magnitude
  }

  private createBitReversal(size: number): Uint32Array {
    const result = new Uint32Array(size)
    const bitCount = Math.log2(size)
    for (let index = 0; index < size; index += 1) {
      let source = index
      let reversed = 0
      for (let bit = 0; bit < bitCount; bit += 1) {
        reversed = (reversed << 1) | (source & 1)
        source >>= 1
      }
      result[index] = reversed
    }
    return result
  }
}
