namespace RedBamboo.AppHost.Auth;

public static class LoginPage
{
    public static string Render()
    {
        return """
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Sign in</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap" rel="stylesheet">
            <style>
                *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

                body {
                    font-family: 'Roboto', sans-serif;
                    background: #0a0a0f;
                    background-image: radial-gradient(ellipse at center, rgba(255,255,255,0.03) 0%, transparent 70%);
                    color: #fff;
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 16px;
                }

                .card {
                    width: 100%;
                    max-width: 400px;
                    background: rgba(255,255,255,0.04);
                    border: 1px solid rgba(255,255,255,0.08);
                    border-radius: 12px;
                    padding: 48px 40px;
                    backdrop-filter: blur(10px);
                    -webkit-backdrop-filter: blur(10px);
                    text-align: center;
                }

                .app-identity {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 32px;
                }

                .app-icon {
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    background: rgba(255,255,255,0.08);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 20px;
                    color: rgba(255,255,255,0.7);
                }

                .app-name {
                    font-size: 18px;
                    font-weight: 500;
                    color: rgba(255,255,255,0.9);
                }

                h1 {
                    font-size: 24px;
                    font-weight: 500;
                    margin-bottom: 32px;
                    color: #fff;
                }

                .google-btn {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    gap: 12px;
                    background: #ffffff;
                    border: 1px solid #dadce0;
                    border-radius: 4px;
                    padding: 10px 24px;
                    min-height: 40px;
                    text-decoration: none;
                    color: #3c4043;
                    font-family: 'Roboto', sans-serif;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: background 0.2s, box-shadow 0.2s;
                }

                .google-btn:hover {
                    background: #f7f8f8;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.15);
                }

                .google-btn svg {
                    flex-shrink: 0;
                }

                .footer {
                    margin-top: 32px;
                    font-size: 12px;
                    color: rgba(255,255,255,0.3);
                }

                @media (max-width: 480px) {
                    .card {
                        max-width: none;
                        padding: 48px 24px;
                    }
                }
            </style>
        </head>
        <body>
            <div class="card">
                <div class="app-identity">
                    <div class="app-icon" id="app-icon"></div>
                    <div class="app-name" id="app-name">Red Suite</div>
                </div>
                <h1>Sign in</h1>
                <a class="google-btn" id="google-btn" href="/auth/login">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="18" height="18">
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                    </svg>
                    Sign in with Google
                </a>
                <div class="footer">Powered by RedBamboo</div>
            </div>
            <script>
                (function() {
                    var params = new URLSearchParams(window.location.search);
                    var returnUrl = params.get('returnUrl') || '/';
                    var btn = document.getElementById('google-btn');
                    btn.href = '/auth/login?returnUrl=' + encodeURIComponent(returnUrl);

                    fetch('/discover')
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.name) {
                                document.getElementById('app-name').textContent = data.name;
                                document.title = 'Sign in — ' + data.name;
                            }
                            if (data.iconClass) {
                                var iconEl = document.getElementById('app-icon');
                                var i = document.createElement('i');
                                i.className = data.iconClass;
                                iconEl.appendChild(i);
                                if (data.iconColor) {
                                    iconEl.style.background = data.iconColor;
                                }
                            }
                        })
                        .catch(function() {});
                })();
            </script>
        </body>
        </html>
        """;
    }
}
