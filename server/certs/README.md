# CA certificates

`cacert.pem` は PHP curl が HTTPS（Groq / OpenAI など）へ接続するときに使います。

XAMPP 既定では CA バンドルが無く、`unable to get local issuer certificate` になることがあります。
このファイルでその問題を回避します。

更新する場合:

https://curl.se/ca/cacert.pem
