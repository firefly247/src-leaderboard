package io.github.firefly247.srcleaderboard;

import java.net.URI;
import java.net.URISyntaxException;

final class NavigationPolicy {
    static final String HOME = "https://firefly247.github.io/src-leaderboard/";

    static boolean isInternal(String url) {
        try {
            URI uri = new URI(url);
            String path = uri.getPath();
            return "https".equalsIgnoreCase(uri.getScheme())
                    && "firefly247.github.io".equalsIgnoreCase(uri.getHost())
                    && (uri.getPort() == -1 || uri.getPort() == 443)
                    && uri.getRawUserInfo() == null
                    && path != null
                    && path.startsWith("/src-leaderboard/")
                    && !path.contains("\\")
                    && !path.contains("/../") && !path.contains("/./")
                    && !path.endsWith("/..") && !path.endsWith("/.");
        } catch (URISyntaxException | NullPointerException error) {
            return false;
        }
    }

    static boolean isBrowserLink(String url) {
        try {
            URI uri = new URI(url);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                    && uri.getRawUserInfo() == null;
        } catch (URISyntaxException | NullPointerException error) {
            return false;
        }
    }
}
