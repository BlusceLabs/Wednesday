# Homebrew formula template for Wednesday.
#
# This is a starting point, not a published formula: the sha256 values below
# are placeholders that must be filled in with the checksums from
# dist/SHA256SUMS after each release is tagged and its GitHub release
# artifacts are published, since Homebrew requires a stable, publicly
# reachable download URL and a checksum computed from the actual artifact.
class Wednesday < Formula
  desc "Personal, local-first AI agent with a terminal UI and HTTP gateway"
  homepage "https://github.com/midknightmantra/wednesday"
  version "1.0.0-rc.6"

  if OS.mac?
    url "https://github.com/midknightmantra/wednesday/releases/download/v1.0.0-rc.6/wednesday-1.0.0-rc.6.tar.gz"
    sha256 "REPLACE_WITH_SHA256SUMS_VALUE"
  elsif OS.linux?
    url "https://github.com/midknightmantra/wednesday/releases/download/v1.0.0-rc.6/wednesday-1.0.0-rc.6.tar.gz"
    sha256 "REPLACE_WITH_SHA256SUMS_VALUE"
  end

  depends_on "bun"
  depends_on "git"
  depends_on "python@3.12" => :recommended

  def install
    libexec.install Dir["*"]
    (bin/"wednesday").write_env_script libexec/"src/index.tsx", {}
  end

  test do
    system "#{bin}/wednesday", "--help"
  end
end
