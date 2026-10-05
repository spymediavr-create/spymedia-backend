// User-controlled private terminal only. No file, network, or environment writes.
const crypto = require("node:crypto");
const {promisify} = require("node:util");
const readline = require("node:readline");
const {Writable} = require("node:stream");

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("T01: 개인 대화형 터미널이 필요합니다. 비밀번호를 일반 $ 명령창에 입력하지 마세요.\n");
    process.exitCode = 2;
    return;
  }
  const muted = new Writable({write(chunk, encoding, done) {done();}});
  muted.isTTY = true;
  muted.columns = process.stdout.columns || 80;
  const rl = readline.createInterface({input:process.stdin, output:muted, terminal:true, historySize:0, prompt:"", crlfDelay:Infinity});
  let phase = "first", password = "", closed = false;
  const labels = {first:"1/2 New password: ",repeat:"2/2 Repeat password: ",approve:"3/3 y=show hash, r=retry: ",hashing:"Hashing; please wait.",done:"Complete. Register the hash in Render; Ctrl+C to exit."};
  function draw() {
    if (closed) return;
    const label = labels[phase];
    if (phase === "hashing" || phase === "done") {
      process.stdout.write("\r\x1b[2K" + label);
      return;
    }
    const size = rl.line.length, suffix = " (" + size + "/256)";
    const visible = Math.min(size, Math.max(8, Math.min(256, (process.stdout.columns || 80) - label.length - suffix.length - 5)));
    const offset = size - visible, head = offset > 0 ? "+" : "";
    const position = label.length + head.length + Math.max(0, Math.min(visible, rl.cursor - offset));
    process.stdout.write("\r\x1b[2K" + label + head + "*".repeat(visible) + suffix + "\r\x1b[" + position + "C");
  }
  function restart(message) {
    password = "";
    phase = "first";
    process.stdout.write(message + "\n도구 안에서 처음부터 다시 입력하세요. 종료하려면 Ctrl+C입니다.\n");
    draw();
  }
  function invalid(value) {
    if (/[\x00-\x1f\x7f-\x9f]/.test(value)) return "C01: 입력에 제어문자 또는 탭이 있습니다.";
    if (value.length < 12) return "L01: 입력 길이가 12자보다 짧습니다.";
    if (value.length > 256) return "L02: 입력 길이가 256자를 넘습니다.";
    return "";
  }
  // Synchronous transitions retain typed-ahead/pasted lines; delay does not split CRLF.
  rl.on("line", value => {
    process.stdout.write("\r\x1b[2K");
    if (phase === "first" || phase === "repeat") {
      const issue = invalid(value);
      if (issue) {restart(issue);return;}
      if (phase === "first") {password = value;phase = "repeat";draw();return;}
      if (value !== password) {restart("M01: 첫 입력과 확인 입력이 다릅니다.");return;}
      phase = "approve";
      process.stdout.write("두 입력이 일치합니다. 해시를 표시하려면 y + Enter, 다시 입력하려면 r + Enter입니다.\n");
      draw();
      return;
    }
    if (phase === "approve") {
      if (value === "r" || value === "R") {restart("처음부터 다시 입력합니다.");return;}
      if (value !== "y" && value !== "Y") {
        process.stdout.write("Y01: 이 단계에는 비밀번호 대신 y 또는 r만 입력하세요.\n");draw();return;
      }
      phase = "hashing";
      draw();
      const salt = crypto.randomBytes(16);
      promisify(crypto.scrypt)(password, salt, 64).then(key => {
        password = "";
        if (!closed) {
          process.stdout.write("\r\x1b[2K아래 = 오른쪽 값만 Render의 ADMIN_PASSWORD_SCRYPT에 직접 등록하세요.\n출력이나 스크린샷을 채팅에 보내지 마세요.\n");
          process.stdout.write("ADMIN_PASSWORD_SCRYPT=" + salt.toString("hex") + ":" + key.toString("hex") + "\n");
          phase = "done";
          draw();
        }
        key.fill(0);
      }).catch(() => {if (!closed) restart("H01: 해시 계산에 실패했습니다. 설정은 변경되지 않았습니다.");});
      return;
    }
    process.stdout.write("이 단계에는 비밀번호를 입력하지 마세요. 새 비밀번호를 만들려면 도구를 종료한 뒤 다시 실행하세요.\n");
    draw();
  });
  rl.on("SIGINT", () => rl.close());
  process.stdin.on("keypress", draw);
  process.stdout.write("SpyMedia password setup v2\n비밀번호는 이 도구 안에서만 입력하세요. 일반 $ 명령창에서는 입력하지 마세요.\n12~256자이며 글자 대신 *와 길이만 표시됩니다. 실패해도 도구는 종료되지 않습니다.\n");
  draw();
  await new Promise(resolve => rl.once("close", () => {
    closed = true;
    password = "";
    process.stdin.removeListener("keypress", draw);
    process.stdout.write("\r\x1b[2K\n도구가 종료됐습니다. 이제 일반 $ 명령창에 비밀번호를 입력하지 마세요.\n");
    resolve();
  }));
}
main().catch(() => {
  process.stderr.write("E01: 도구가 종료됐습니다. 일반 $ 명령창에 비밀번호를 입력하지 말고 도구를 다시 실행하세요.\n");
  process.exitCode = 1;
});
