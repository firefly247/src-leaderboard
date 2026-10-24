package io.github.firefly247.srcleaderboard;

public final class NavigationPolicyTest {
    public static void main(String[] args) {
        String[] allowed = { NavigationPolicy.HOME, NavigationPolicy.HOME + "#request",
                NavigationPolicy.HOME + "?test=1", "https://firefly247.github.io:443/src-leaderboard/index.html" };
        String[] blocked = { null, "", "http://firefly247.github.io/src-leaderboard/",
                "https://firefly247.github.io/another-site/", "https://firefly247.github.io/src-leaderboard-fake/",
                "https://firefly247.github.io.evil.example/src-leaderboard/", "https://user@firefly247.github.io/src-leaderboard/",
                "https://firefly247.github.io:8443/src-leaderboard/", "file:///data/local/secret",
                "content://private/data", "javascript:alert(1)", "intent://settings",
                "https://firefly247.github.io/src-leaderboard/..", "https://firefly247.github.io/src-leaderboard/%2e%2e/secret",
                "https://firefly247.github.io/src-leaderboard/a/./b", "https://firefly247.github.io/src-leaderboard/a\\..\\b" };
        for (String url : allowed) if (!NavigationPolicy.isInternal(url)) throw new AssertionError("Rejected own site: " + url);
        for (String url : blocked) if (NavigationPolicy.isInternal(url)) throw new AssertionError("Allowed unsafe navigation: " + url);
        if (!NavigationPolicy.isBrowserLink("https://example.com/")) throw new AssertionError("External HTTPS link rejected");
        for (String url : new String[] { "javascript:alert(1)", "file:///tmp/a", "intent://settings", "http://example.com/" })
            if (NavigationPolicy.isBrowserLink(url)) throw new AssertionError("Unsafe browser handoff: " + url);
        System.out.println("Navigation policy tests passed (" + (allowed.length + blocked.length + 5) + " checks)");
    }
}
