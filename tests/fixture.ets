@Entry
@Component
struct Index {
  @State count: number = 0;
  @State input: string = '';
  private rows: number[] = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];

  aboutToAppear(): void {
    console.info('serve-hos fixture ready');
  }

  build() {
    Column({ space: 16 }) {
      Text('serve-hos acceptance').fontSize(28).fontWeight(FontWeight.Bold)
      Text('Count: ' + this.count).id('fixture-count').fontSize(24)
      Button('Increment').id('fixture-increment').onClick(() => { this.count += 1; })
      TextInput({ placeholder: 'Type here', text: this.input })
        .id('fixture-input').width('80%').onChange((value: string) => { this.input = value; })
      Text('Input: ' + this.input).id('fixture-echo').fontSize(20)
      Scroll() {
        Column({ space: 18 }) {
          ForEach(this.rows, (row: number) => {
            Text('Row ' + row).fontSize(22).height(50).width('100%')
          })
        }.width('100%')
      }.id('fixture-scroll').height(260).width('80%')
    }.width('100%').height('100%').padding(32).backgroundColor('#F5F7FA')
  }
}
