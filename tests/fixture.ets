@Entry
@Component
struct Index {
  @State count: number = 0;
  @State input: string = '';
  @State doubleCount: number = 0;
  @State longCount: number = 0;
  @State dragCount: number = 0;
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
      Row({ space: 12 }) {
        Text('Double: ' + this.doubleCount).id('fixture-double').width('30%').height(48)
          .backgroundColor('#DEE8FF').gesture(TapGesture({ count: 2 }).onAction(() => { this.doubleCount += 1; }))
        Text('Long: ' + this.longCount).id('fixture-long').width('30%').height(48)
          .backgroundColor('#DEE8FF').gesture(LongPressGesture({ duration: 500 }).onAction(() => { this.longCount += 1; }))
        Text('Drag: ' + this.dragCount).id('fixture-drag').width('30%').height(48)
          .backgroundColor('#DEE8FF').gesture(PanGesture().onActionEnd(() => { this.dragCount += 1; }))
      }.width('80%')
      Scroll() {
        Column({ space: 18 }) {
          ForEach(this.rows, (row: number) => {
            Text('Row ' + row).fontSize(22).height(50).width('100%')
          }, (row: number): string => row.toString())
        }.width('100%')
      }.id('fixture-scroll').height(260).width('80%')
    }.width('100%').height('100%').padding(32).backgroundColor('#F5F7FA')
  }
}
