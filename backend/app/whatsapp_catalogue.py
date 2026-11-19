"""Submission specifications, not evidence of Meta approval. No credentials here."""

OTP_EXPIRY_MINUTES = 10
CONSENT_TEXT = "I agree to receive transactional WhatsApp messages from Rashi Kapoor, including order confirmations, payment updates, shipping, delivery and refund notifications, at the WhatsApp number provided. I can opt out at any time."


def utility(name, events, parameters, body, handler):
    return {"name": name, "category": "UTILITY", "language": "en_US", "events": events,
            "parameters": parameters, "parameterTypes": ["text"] * len(parameters),
            "body": body, "handler": handler, "approvalStatus": "NOT_SUBMITTED"}


CATALOGUE = {'rk_authentication_otp': {'name': 'rk_authentication_otp',
                           'category': 'AUTHENTICATION',
                           'language': 'en_US',
                           'events': ['signup_otp', 'login_otp', 'forgot_password_otp'],
                           'parameters': ['code'],
                           'parameterTypes': ['otp'],
                           'approvalStatus': 'NOT_SUBMITTED',
                           'body': '*{{1}}* is your verification code. For your security, do not share this code.',
                           'footer': 'This code expires in 10 minutes.',
                           'otpExpiryMinutes': 10,
                           'handler': 'auth.signup_request_otp / request_otp / forgot_password_request_otp '
                                      '(explicit WhatsApp request)',
                           'submissionComponents': [{'type': 'BODY', 'add_security_recommendation': True},
                                                    {'type': 'FOOTER', 'code_expiration_minutes': 10},
                                                    {'type': 'BUTTONS',
                                                     'buttons': [{'type': 'OTP',
                                                                  'otp_type': 'COPY_CODE',
                                                                  'text': 'Copy code'}]}]},
 'rk_order_confirmation': {'name': 'rk_order_confirmation',
                           'category': 'UTILITY',
                           'language': 'en_US',
                           'events': ['order_confirmation'],
                           'parameters': ['customer_name', 'order_number', 'order_date', 'order_total'],
                           'parameterTypes': ['text', 'text', 'text', 'text'],
                           'body': 'Dear {{1}},\n'
                                   '\n'
                                   'Thank you for choosing Rashi Kapoor.\n'
                                   '\n'
                                   'Your order has been successfully confirmed.\n'
                                   '\n'
                                   'Order Confirmation No.: {{2}}\n'
                                   '\n'
                                   'Order Date: {{3}}\n'
                                   '\n'
                                   'Order Total: {{4}}\n'
                                   '\n'
                                   'We appreciate your trust in Rashi Kapoor and will keep you updated on your '
                                   'order.',
                           'handler': 'order_confirmation.send_order_confirmation; '
                                      'order_fulfillment.apply_transition(confirmed)',
                           'approvalStatus': 'NOT_SUBMITTED',
                           'header': 'Order Confirmed',
                           'footer': 'Rashi Kapoor'},
 'rk_payment_confirmation': {'name': 'rk_payment_confirmation',
                             'category': 'UTILITY',
                             'language': 'en_US',
                             'events': ['payment_confirmation'],
                             'parameters': ['customer_name', 'order_number', 'paid_amount', 'payment_reference'],
                             'parameterTypes': ['text', 'text', 'text', 'text'],
                             'body': 'Dear {{1}} ,\n'
                                     '\n'
                                     'We are pleased to confirm that your payment has been successfully '
                                     'received.\n'
                                     '\n'
                                     'Order Confirmation No.: {{2}}\n'
                                     '\n'
                                     'Amount Paid: {{3}}\n'
                                     '\n'
                                     'Payment Reference: {{4}}\n'
                                     '\n'
                                     'Your order is now being processed.\n'
                                     '\n'
                                     'Thank you for shopping with Rashi Kapoor.',
                             'handler': 'payments._fulfil_paid_order -> '
                                        'order_confirmation.send_order_confirmation',
                             'approvalStatus': 'NOT_SUBMITTED',
                             'header': 'Payment Received',
                             'footer': 'Rashi Kapoor Official'},
 'rk_order_shipped': {'name': 'rk_order_shipped',
                      'category': 'UTILITY',
                      'language': 'en_US',
                      'events': ['shipped'],
                      'parameters': ['customer_name', 'order_number', 'courier_name', 'tracking_id'],
                      'parameterTypes': ['text', 'text', 'text', 'text'],
                      'body': 'Dear {{1}},\n'
                              '\n'
                              'Good news! Your Rashi Kapoor order is on its way.\n'
                              '\n'
                              'Order Confirmation No.: {{2}}\n'
                              '\n'
                              'Courier Partner: {{3}}\n'
                              '\n'
                              'Tracking / AWB Number: {{4}}\n'
                              '\n'
                              'You can use the tracking number above to follow your shipment.\n'
                              '\n'
                              'Thank you for choosing Rashi Kapoor.',
                      'handler': 'order_fulfillment.apply_transition / update_shipment (saved courier and '
                                 'tracking required)',
                      'approvalStatus': 'NOT_SUBMITTED',
                      'header': 'Your Order Has Been Shipped',
                      'footer': 'Rashi Kapoor Official'},
 'rk_out_for_delivery': {'name': 'rk_out_for_delivery',
                         'category': 'UTILITY',
                         'language': 'en_US',
                         'events': ['out_for_delivery'],
                         'parameters': ['customer_name', 'order_number', 'courier_name', 'tracking_id'],
                         'parameterTypes': ['text', 'text', 'text', 'text'],
                         'body': 'Dear {{1}},\n'
                                 '\n'
                                 'Your Rashi Kapoor order is scheduled for delivery today.\n'
                                 '\n'
                                 'Order Confirmation No.: {{2}}\n'
                                 '\n'
                                 'Courier Partner: {{3}}\n'
                                 '\n'
                                 'Tracking / AWB Number: {{4}}\n'
                                 '\n'
                                 'Please keep your phone available to coordinate the delivery.\n'
                                 '\n'
                                 'We hope you enjoy your Rashi Kapoor purchase.',
                         'handler': 'order_fulfillment.apply_transition(out_for_delivery), staff records actual '
                                    'courier status',
                         'approvalStatus': 'NOT_SUBMITTED',
                         'header': 'Out for Delivery',
                         'footer': 'Rashi Kapoor Official'},
 'rk_order_delivered': {'name': 'rk_order_delivered',
                        'category': 'UTILITY',
                        'language': 'en_US',
                        'events': ['delivered'],
                        'parameters': ['customer_name', 'order_number', 'delivered_on'],
                        'parameterTypes': ['text', 'text', 'text'],
                        'body': 'Dear {{1}},\n'
                                '\n'
                                'Your Rashi Kapoor order has been successfully delivered.\n'
                                '\n'
                                'Order Confirmation No.: {{2}}\n'
                                '\n'
                                'Delivered On: {{3}}\n'
                                '\n'
                                'We hope your purchase brings you joy.\n'
                                '\n'
                                'Thank you for choosing Rashi Kapoor. We look forward to welcoming you again.',
                        'handler': 'order_fulfillment.apply_transition(delivered)',
                        'approvalStatus': 'NOT_SUBMITTED',
                        'header': 'Order Successfully Delivered',
                        'footer': 'Rashi Kapoor Official'},
 'rk_order_cancelled': {'name': 'rk_order_cancelled',
                        'category': 'UTILITY',
                        'language': 'en_US',
                        'events': ['cancelled'],
                        'parameters': ['customer_name', 'order_number', 'cancellation_reference'],
                        'parameterTypes': ['text', 'text', 'text'],
                        'body': 'Dear {{1}},\n'
                                '\n'
                                'This is to inform you that your Rashi Kapoor order has been cancelled.\n'
                                '\n'
                                'Order Confirmation No.: {{2}} \n'
                                '\n'
                                'Cancellation Reference: {{3}}\n'
                                '\n'
                                'If a payment has already been captured, any applicable refund will be '
                                'communicated separately.\n'
                                '\n'
                                'For assistance, please contact our customer support team.',
                        'handler': 'order_fulfillment.apply_transition(cancelled)',
                        'approvalStatus': 'NOT_SUBMITTED',
                        'header': 'Order Cancellation',
                        'footer': 'Rashi Kapoor Official'},
 'rk_refund_processed': {'name': 'rk_refund_processed',
                         'category': 'UTILITY',
                         'language': 'en_US',
                         'events': ['refund_completed'],
                         'parameters': ['customer_name', 'order_number', 'refund_amount', 'refund_reference'],
                         'parameterTypes': ['text', 'text', 'text', 'text'],
                         'body': 'Dear {{1}},\n'
                                 '\n'
                                 'We would like to inform you that your refund has been successfully processed.\n'
                                 '\n'
                                 'Order Confirmation No.: {{2}}\n'
                                 '\n'
                                 'Refund Amount: {{3}}\n'
                                 '\n'
                                 'Refund Reference: {{4}}\n'
                                 '\n'
                                 'The refunded amount may take some time to appear in your original payment '
                                 'method, depending on your bank or payment provider.\n'
                                 '\n'
                                 'Thank you for your understanding.\n'
                                 '\n'
                                 'Team Rashi Kapoor',
                         'handler': 'payments.razorpay_webhook(refund.processed), verified gateway result only',
                         'approvalStatus': 'NOT_SUBMITTED',
                         'header': 'Refund Processed',
                         'footer': 'Rashi Kapoor Official'}}

STATUS_UPDATE_EVENTS = ["order_accepted", "order_rejected", "processing", "packed", "advance_payment_received", "part_payment_received", "payment_received"]
CATALOGUE["rk_order_placed"] = utility("rk_order_placed", ["order_placed"], ["customer_name", "order_number", "order_total"],
    "Dear {{1}},\n\nWe have received your order {{2}} for {{3}}.\n\nYour order is currently pending review by our team. Payment is pending. Our team will contact you shortly with the next steps.\n\nPlease wait for payment instructions.", "manual checkout")
CATALOGUE["rk_order_placed"]["header"] = "Order Received"
CATALOGUE["rk_order_status_update"] = utility("rk_order_status_update", STATUS_UPDATE_EVENTS,
    ["customer_name", "order_number", "event_label", "payment_status", "amount_received", "balance_due"],
    "Dear {{1}},\n\nAn update for your Rashi Kapoor order {{2}}: {{3}}.\n\nPayment status: {{4}}\nAmount received: {{5}}\nBalance due: {{6}}\n\nOur team will keep you updated.", "saved order status and manual ledger events")
CATALOGUE["rk_order_status_update"]["header"] = "Order Update"

EVENT_CATALOGUE = {event: name for name, template in CATALOGUE.items() for event in template["events"]}
